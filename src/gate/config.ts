import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { isNode, LineCounter, parseDocument, type Document } from "yaml";

import { PROFILES, type DotnetGuard, type Guard, type GuardException, type Profile, type Step } from "./contract.ts";

export const CONFIG_FILE = "suwgate.yml";

const SCHEMA_FILE = new URL("../../schema/suwgate.schema.json", import.meta.url);

export const MAX_ALIASES = 10_000;

const DOTNET_GUARD_PREFIXES: Readonly<Record<string, Profile>> = { "architecture/": "dotnet", "database/": "database" };

interface AddedStep {
    name: string;
    run: string;
    title?: string;
    quick?: boolean;
    after?: string[];
    limitSeconds?: number;
}

interface SkippedStep {
    step: string;
    reason: string;
}

interface SkippedGuard {
    guard: string;
    reason: string;
}

export interface Environment {
    env?: Record<string, string>;
    unset?: string[];
}

interface ConfiguredStep extends Environment {
    limitSeconds?: number;
    after?: string[];
    settings?: unknown;
}

export interface Config {
    profiles: Profile[];
    directories: Partial<Record<Profile, string>>;
    add: AddedStep[];
    skip: SkippedStep[];
    configure: Record<string, ConfiguredStep>;
    environment: Environment;
    skippedGuards: SkippedGuard[];
    exceptions: GuardException[];
    settings: Record<string, unknown>;
    quickLimitSeconds?: number;
}

interface RawConfig {
    profiles: Profile[];
    directories?: Partial<Record<Profile, string>>;
    steps?: { add?: AddedStep[]; skip?: SkippedStep[]; configure?: Record<string, ConfiguredStep> };
    guards?: { skip?: SkippedGuard[] };
    env?: Environment["env"];
    unset?: string[];
    exceptions?: GuardException[];
    settings?: Record<string, unknown>;
    quick?: { limitSeconds?: number };
}

export interface Catalog {
    guards: readonly Guard[];
    dotnetGuards: readonly DotnetGuard[];
    stepsFor(profiles: readonly Profile[]): readonly Step[];
}

export type Loaded = { config: Config } | { problems: string[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateFile = ajv.compile<RawConfig>(JSON.parse(readFileSync(SCHEMA_FILE, "utf8")) as object);

function segments(pointer: string): (string | number)[] {
    return pointer
        .split("/")
        .slice(1)
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
        .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function shownPath(parts: readonly (string | number)[]): string {
    return parts.reduce<string>(
        (shown, part) => (typeof part === "number" ? `${shown}[${part}]` : shown === "" ? part : `${shown}.${part}`),
        "",
    );
}

function locate(document: Document, lineCounter: LineCounter, parts: readonly (string | number)[]): string {
    for (let length = parts.length; length >= 0; length--) {
        const node: unknown = length === 0 ? document.contents : document.getIn(parts.slice(0, length), true);
        if (isNode(node) && node.range !== undefined && node.range !== null) {
            const { line, col } = lineCounter.linePos(node.range[0]);
            return `${CONFIG_FILE}:${line}:${col}`;
        }
    }
    return CONFIG_FILE;
}

function describe(error: ErrorObject): string {
    const parts = segments(error.instancePath);
    const where = parts.length === 0 ? "the file" : shownPath(parts);
    const params = error.params as Record<string, unknown>;
    switch (error.keyword) {
        case "required": {
            const missing = String(params["missingProperty"]);
            const what = parts[0] === "exceptions" ? "exception" : parts[0] === "guards" ? "skipped guard" : "skipped step";
            const fix = missing === "reason" ? `: every ${what} says why (reason: <why>)` : "";
            return `${where} has no "${missing}"${fix}`;
        }
        case "additionalProperties":
            return `${where} has an unknown key "${String(params["additionalProperty"])}": check its spelling against the schema`;
        case "propertyNames":
            return `${where} has a key that is not allowed: ${String(params["propertyName"])}`;
        case "enum":
            return `${where} must be one of ${JSON.stringify(params["allowedValues"])}`;
        case "pattern":
            return parts.at(-1) === "reason"
                ? `${where} is empty: say why, in a sentence a reviewer can judge`
                : `${where} ${error.message ?? "is not valid"}`;
        default:
            return `${where} ${error.message ?? "is not valid"}`;
    }
}

function relevant(errors: readonly ErrorObject[]): ErrorObject[] {
    return errors.filter(
        (error) => error.keyword !== "if" && !(error.keyword === "enum" && errors.some((other) => other.keyword === "propertyNames")),
    );
}

function guardProfile(id: string, guards: readonly Guard[]): readonly Profile[] | "every" | "dotnet-guard" | null {
    if (Object.keys(DOTNET_GUARD_PREFIXES).some((prefix) => id.startsWith(prefix))) return "dotnet-guard";
    return guards.find((guard) => guard.id === id)?.profiles ?? null;
}

function checkExceptions(raw: RawConfig, catalog: Catalog, problem: (parts: (string | number)[], text: string) => void): void {
    const seen = new Set<string>();
    (raw.exceptions ?? []).forEach((exception, index) => {
        const where = ["exceptions", index];
        const profiles = guardProfile(exception.guard, catalog.guards);
        if (profiles === null) {
            problem(
                where,
                `no guard "${exception.guard}": the guards are ${catalog.guards.map((guard) => guard.id).join(", ")} (and architecture/*, database/* of the .NET packages)`,
            );
        } else if (profiles === "dotnet-guard") {
            const prefix = Object.keys(DOTNET_GUARD_PREFIXES).find((candidate) => exception.guard.startsWith(candidate)) ?? "";
            const needed = DOTNET_GUARD_PREFIXES[prefix];
            if (needed !== undefined && !raw.profiles.includes(needed)) {
                problem(
                    where,
                    `"${exception.guard}" is a guard of the ${needed} profile, which this repository does not have: delete the exception`,
                );
            }
        } else if (profiles !== "every" && !profiles.some((profile) => raw.profiles.includes(profile))) {
            problem(
                where,
                `"${exception.guard}" runs only for ${profiles.join(", ")}, which this repository does not have: delete the exception`,
            );
        }
        const key = `${exception.guard}\u0000${exception.target}\u0000${exception.message ?? ""}`;
        if (seen.has(key)) problem(where, `the same exception (${exception.guard}, ${exception.target}) is listed twice: keep one`);
        seen.add(key);
    });
}

function checkSteps(raw: RawConfig, catalog: Catalog, problem: (parts: (string | number)[], text: string) => void): void {
    const known = catalog.stepsFor(raw.profiles).map((step) => step.id);
    const added = (raw.steps?.add ?? []).map((step) => step.name);
    (raw.steps?.add ?? []).forEach((step, index) => {
        if (known.includes(step.name))
            problem(["steps", "add", index, "name"], `the profiles already have a step "${step.name}": pick another name, or skip theirs`);
        if (added.indexOf(step.name) !== index) problem(["steps", "add", index, "name"], `"${step.name}" is added twice`);
        (step.after ?? []).forEach((after, at) => {
            if (!known.includes(after) && !added.includes(after)) {
                problem(["steps", "add", index, "after", at], `no step "${after}": the steps are ${[...known, ...added].join(", ")}`);
            }
        });
    });
    (raw.steps?.skip ?? []).forEach((skipped, index) => {
        if (!known.includes(skipped.step)) {
            problem(
                ["steps", "skip", index, "step"],
                `the profiles ${raw.profiles.join(", ")} have no step "${skipped.step}": their steps are ${known.join(", ")}`,
            );
        }
    });
}

function checkConfigure(raw: RawConfig, catalog: Catalog, problem: (parts: (string | number)[], text: string) => void): void {
    const steps = catalog.stepsFor(raw.profiles);
    const known = steps.map((step) => step.id);
    const added = (raw.steps?.add ?? []).map((step) => step.name);
    const skipped = (raw.steps?.skip ?? []).map((entry) => entry.step);
    for (const [id, configured] of Object.entries(raw.steps?.configure ?? {})) {
        const where = ["steps", "configure", id];
        const step = steps.find((candidate) => candidate.id === id);
        if (step === undefined) {
            problem(
                where,
                added.includes(id)
                    ? `"${id}" is added in steps.add, which takes its limitSeconds and after itself; steps.configure is for the steps of the profiles`
                    : `the profiles ${raw.profiles.join(", ")} have no step "${id}": their steps are ${known.join(", ")}`,
            );
            continue;
        }
        if (skipped.includes(id))
            problem(where, `"${id}" is skipped in steps.skip, so this configuration is never used: delete it, or the skip`);
        (configured.after ?? []).forEach((after, at) => {
            if (after === id) problem([...where, "after", at], `"${id}" cannot wait for itself`);
            else if (!known.includes(after) && !added.includes(after))
                problem([...where, "after", at], `no step "${after}": the steps are ${[...known, ...added].join(", ")}`);
        });
        if (configured.settings === undefined) continue;
        if (step.settingsSchema === undefined) {
            problem([...where, "settings"], `the step "${id}" takes no settings`);
            continue;
        }
        const validate = ajv.compile(step.settingsSchema);
        if (!validate(configured.settings)) {
            for (const error of relevant(validate.errors ?? [])) {
                problem(
                    [...where, "settings", ...segments(error.instancePath)],
                    describe({ ...error, instancePath: `/steps/configure/${id}/settings${error.instancePath}` }),
                );
            }
        }
    }
}

function circle(raw: RawConfig, catalog: Catalog): string[] | null {
    const waits = new Map<string, string[]>();
    for (const step of catalog.stepsFor(raw.profiles)) {
        waits.set(step.id, [...(step.after ?? []), ...(step.orderAfter ?? []), ...(raw.steps?.configure?.[step.id]?.after ?? [])]);
    }
    for (const step of raw.steps?.add ?? []) waits.set(step.name, step.after ?? []);
    const done = new Set<string>();
    const visit = (id: string, path: readonly string[]): string[] | null => {
        if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
        if (done.has(id)) return null;
        for (const next of waits.get(id) ?? []) {
            const found = visit(next, [...path, id]);
            if (found !== null) return found;
        }
        done.add(id);
        return null;
    };
    for (const id of waits.keys()) {
        const found = visit(id, []);
        if (found !== null) return found;
    }
    return null;
}

function profilesOf(id: string, catalog: Catalog): readonly Profile[] | "every" | null {
    const dotnet = catalog.dotnetGuards.find((guard) => guard.id === id);
    if (dotnet !== undefined) return [dotnet.profile];
    return catalog.guards.find((guard) => guard.id === id)?.profiles ?? null;
}

function checkSkippedGuards(raw: RawConfig, catalog: Catalog, problem: (parts: (string | number)[], text: string) => void): void {
    const skipped = (raw.guards?.skip ?? []).map((entry) => entry.guard);
    (raw.guards?.skip ?? []).forEach((entry, index) => {
        const where = ["guards", "skip", index, "guard"];
        const profiles = profilesOf(entry.guard, catalog);
        if (profiles === null) {
            const known = [...catalog.guards.map((guard) => guard.id), ...catalog.dotnetGuards.map((guard) => guard.id)];
            problem(where, `no guard "${entry.guard}": the guards are ${known.join(", ")}`);
        } else if (profiles !== "every" && !profiles.some((profile) => raw.profiles.includes(profile))) {
            problem(where, `"${entry.guard}" runs only for ${profiles.join(", ")}, which this repository does not have: delete the entry`);
        }
        if (skipped.indexOf(entry.guard) !== index) problem(where, `"${entry.guard}" is skipped twice: keep one entry`);
    });
    (raw.exceptions ?? []).forEach((exception, index) => {
        if (skipped.includes(exception.guard)) {
            problem(
                ["exceptions", index],
                `"${exception.guard}" is skipped in guards.skip, so this exception is never checked: delete it, or the skip`,
            );
        }
    });
}

function checkSettings(raw: RawConfig, catalog: Catalog, problem: (parts: (string | number)[], text: string) => void): void {
    for (const [id, value] of Object.entries(raw.settings ?? {})) {
        const guard =
            catalog.guards.find((candidate) => candidate.id === id) ?? catalog.dotnetGuards.find((candidate) => candidate.id === id);
        if (guard?.settingsSchema === undefined) {
            problem(["settings", id], guard === undefined ? `no guard "${id}"` : `the guard "${id}" takes no settings`);
            continue;
        }
        const validate = ajv.compile(guard.settingsSchema);
        if (!validate(value)) {
            for (const error of relevant(validate.errors ?? [])) {
                const inner = segments(error.instancePath);
                problem(["settings", id, ...inner], describe({ ...error, instancePath: `/settings/${id}${error.instancePath}` }));
            }
        }
    }
}

function checkDirectories(raw: RawConfig, problem: (parts: (string | number)[], text: string) => void): void {
    for (const profile of Object.keys(raw.directories ?? {})) {
        if (!raw.profiles.includes(profile as Profile))
            problem(["directories", profile], `"${profile}" is not one of this repository's profiles`);
    }
}

export function parseConfig(text: string, catalog: Catalog): Loaded {
    const lineCounter = new LineCounter();
    const document = parseDocument(text, { lineCounter, prettyErrors: true, uniqueKeys: true });
    if (document.errors.length > 0) {
        return {
            problems: document.errors.map(
                (error) =>
                    `${CONFIG_FILE}:${error.linePos?.[0].line ?? 1}:${error.linePos?.[0].col ?? 1}: ${(error.message.split("\n")[0] ?? "").replace(/ at line \d+, column \d+:?$/, "")}`,
            ),
        };
    }
    let data: unknown;
    try {
        data = document.toJS({ maxAliasCount: MAX_ALIASES });
    } catch (error) {
        return { problems: [`${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!validateFile(data)) {
        return {
            problems: relevant(validateFile.errors ?? []).map(
                (error) => `${locate(document, lineCounter, segments(error.instancePath))}: ${describe(error)}`,
            ),
        };
    }
    const problems: string[] = [];
    const problem = (parts: (string | number)[], text: string) => {
        problems.push(`${locate(document, lineCounter, parts)}: ${shownPath(parts)}: ${text}`);
    };
    checkDirectories(data, problem);
    checkExceptions(data, catalog, problem);
    checkSteps(data, catalog, problem);
    checkSkippedGuards(data, catalog, problem);
    checkSettings(data, catalog, problem);
    checkConfigure(data, catalog, problem);
    if (problems.length === 0) {
        const found = circle(data, catalog);
        if (found !== null)
            problem(["steps"], `steps wait for each other in a circle: ${found.join(" -> ")}: drop one of these after entries`);
    }
    if (problems.length > 0) return { problems };
    return {
        config: {
            profiles: PROFILES.filter((profile) => data.profiles.includes(profile)),
            directories: data.directories ?? {},
            add: data.steps?.add ?? [],
            skip: data.steps?.skip ?? [],
            configure: data.steps?.configure ?? {},
            environment: {
                ...(data.env === undefined ? {} : { env: data.env }),
                ...(data.unset === undefined ? {} : { unset: data.unset }),
            },
            skippedGuards: data.guards?.skip ?? [],
            exceptions: data.exceptions ?? [],
            settings: data.settings ?? {},
            ...(data.quick?.limitSeconds === undefined ? {} : { quickLimitSeconds: data.quick.limitSeconds }),
        },
    };
}

export function loadConfig(root: string, catalog: Catalog): Loaded {
    const file = path.join(root, CONFIG_FILE);
    if (!existsSync(file)) {
        return { problems: [`no ${CONFIG_FILE} in ${root}: create it with at least \`profiles: [<${PROFILES.join(" | ")}>]\``] };
    }
    return parseConfig(readFileSync(file, "utf8"), catalog);
}
