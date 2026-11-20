import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { isNode, LineCounter, parseDocument, type Document } from "yaml";

import { PROFILES, type Guard, type GuardException, type Profile, type Step } from "./contract.ts";

export const CONFIG_FILE = "suwgate.yml";

const SCHEMA_FILE = new URL("../../schema/suwgate.schema.json", import.meta.url);

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

export interface Config {
    profiles: Profile[];
    directories: Partial<Record<Profile, string>>;
    add: AddedStep[];
    skip: SkippedStep[];
    exceptions: GuardException[];
    settings: Record<string, unknown>;
    quickLimitSeconds?: number;
}

interface RawConfig {
    profiles: Profile[];
    directories?: Partial<Record<Profile, string>>;
    steps?: { add?: AddedStep[]; skip?: SkippedStep[] };
    exceptions?: GuardException[];
    settings?: Record<string, unknown>;
    quick?: { limitSeconds?: number };
}

export interface Catalog {
    guards: readonly Guard[];
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
            const fix =
                missing === "reason" ? `: every ${parts[0] === "exceptions" ? "exception" : "skipped step"} says why (reason: <why>)` : "";
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
        const key = `${exception.guard}\u0000${exception.target}`;
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

function checkSettings(raw: RawConfig, catalog: Catalog, problem: (parts: (string | number)[], text: string) => void): void {
    for (const [id, value] of Object.entries(raw.settings ?? {})) {
        const guard = catalog.guards.find((candidate) => candidate.id === id);
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
    const data: unknown = document.toJS();
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
    checkSettings(data, catalog, problem);
    if (problems.length > 0) return { problems };
    return {
        config: {
            profiles: PROFILES.filter((profile) => data.profiles.includes(profile)),
            directories: data.directories ?? {},
            add: data.steps?.add ?? [],
            skip: data.steps?.skip ?? [],
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
