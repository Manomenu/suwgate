import { accessSync, constants } from "node:fs";
import path from "node:path";

import type { Catalog, Config, Environment } from "./config.ts";
import type { GuardException, Run, Step, StepContext } from "./contract.ts";
import { runGuards } from "./guardsStep.ts";

const DEFAULT_LIMIT_SECONDS = 300;

export const GUARDS_STEP = "guards";

export interface Outcome {
    passed: boolean;
    log: string;
}

export interface PlannedStep {
    id: string;
    title: string;
    after: readonly string[];
    limitSeconds: number;
    environment: readonly Environment[];
    skipped?: { reason: string; byConfig: boolean };
    command?: { line: string; cwd: string; args?: readonly string[] };
    inline?: () => Promise<Outcome>;
}

export interface Target {
    id: string;
    only: boolean;
    args: readonly string[];
}

export interface PlanInput {
    root: string;
    quick: boolean;
    config: Config;
    catalog: Catalog;
    files: readonly string[];
    changed: () => readonly string[];
    merged?: readonly GuardException[];
    target?: Target;
}

export interface ListedStep {
    id: string;
    title: string;
    args?: string;
    skipped?: string;
}

function onPath(tool: string): boolean {
    return (process.env["PATH"] ?? "").split(path.delimiter).some((folder) => {
        try {
            accessSync(path.join(folder, tool), constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

function addedSteps(config: Config): Step[] {
    return config.add.map((added) => ({
        id: added.name,
        title: added.title ?? added.name,
        run: added.run,
        ...(added.quick === true ? { quick: true as const } : {}),
        ...(added.after === undefined ? {} : { after: added.after }),
        ...(added.limitSeconds === undefined ? {} : { limitSeconds: added.limitSeconds }),
    }));
}

export function allSteps(config: Config, catalog: Catalog): Step[] {
    return [...catalog.stepsFor(config.profiles), ...addedSteps(config)];
}

function chosenRun(step: Step, quick: boolean): Run | undefined {
    if (!quick) return step.run;
    if (step.quick === true) return step.run;
    return step.quick;
}

function activeGuards(input: PlanInput) {
    const skipped = input.config.skippedGuards.map((entry) => entry.guard);
    return input.catalog.guards.filter(
        (guard) =>
            (guard.profiles === "every" || guard.profiles.some((profile) => input.config.profiles.includes(profile))) &&
            (!input.quick || guard.quick !== false) &&
            !skipped.includes(guard.id),
    );
}

function guardsTitle(input: PlanInput): string {
    const skipped = input.config.skippedGuards.map((entry) => entry.guard);
    const skippedHere = input.catalog.guards.filter((guard) => skipped.includes(guard.id)).length;
    return `repository guards (${activeGuards(input).length}${skippedHere === 0 ? "" : `, ${skippedHere} skipped in suwgate.yml`})`;
}

function guardsStep(input: PlanInput): PlannedStep {
    const active = activeGuards(input);
    return {
        id: GUARDS_STEP,
        title: guardsTitle(input),
        after: [],
        limitSeconds: DEFAULT_LIMIT_SECONDS,
        environment: [],
        inline: async () => {
            const summary = await runGuards({
                root: input.root,
                guards: active,
                files: input.files,
                config: input.config,
                merged: input.merged ?? [],
            });
            return { passed: summary.passed, log: summary.log };
        },
    };
}

function needed(step: Step, config: Config): string[] {
    return [...(step.after ?? []), ...(config.configure[step.id]?.after ?? [])];
}

function selected(steps: readonly Step[], input: PlanInput): Set<string> {
    const { target } = input;
    if (target === undefined) return new Set([GUARDS_STEP, ...steps.map((step) => step.id)]);
    const chosen = new Set<string>();
    const visit = (id: string) => {
        if (chosen.has(id)) return;
        chosen.add(id);
        const step = steps.find((candidate) => candidate.id === id);
        if (step !== undefined && !target.only) needed(step, input.config).forEach(visit);
    };
    visit(target.id);
    return chosen;
}

function environmentOf(step: Step, config: Config): Environment[] {
    const own = config.configure[step.id];
    return [config.environment, ...(own === undefined ? [] : [{ ...own }])].filter(
        (layer) => layer.env !== undefined || layer.unset !== undefined,
    );
}

function stepContext(input: PlanInput, cwd: string): StepContext {
    return {
        root: input.root,
        cwd,
        quick: input.quick,
        profiles: input.config.profiles,
        directories: input.config.directories,
        skippedSteps: input.config.skip.map((skipped) => skipped.step),
        skippedGuards: input.config.skippedGuards.map((skipped) => skipped.guard),
        settings: Object.fromEntries(
            Object.entries(input.config.configure).flatMap(([id, configured]) =>
                configured.settings === undefined ? [] : [[id, configured.settings]],
            ),
        ),
        changed: input.changed,
    };
}

export function plan(input: PlanInput): PlannedStep[] {
    const steps = allSteps(input.config, input.catalog);
    const chosen = selected(steps, input);
    const planned: PlannedStep[] = chosen.has(GUARDS_STEP) ? [guardsStep(input)] : [];
    for (const step of steps.filter((candidate) => chosen.has(candidate.id))) {
        const asked = input.target?.id === step.id;
        const run = chosenRun(step, input.quick);
        if (run === undefined) continue;
        const cwd = path.join(input.root, (step.profile === undefined ? undefined : input.config.directories[step.profile]) ?? "");
        const configured = input.config.configure[step.id];
        const base = {
            id: step.id,
            title: step.title,
            after: [...needed(step, input.config), ...(step.orderAfter ?? [])],
            limitSeconds: configured?.limitSeconds ?? step.limitSeconds ?? DEFAULT_LIMIT_SECONDS,
            environment: environmentOf(step, input.config),
        };
        const skippedByConfig = input.config.skip.find((skipped) => skipped.step === step.id);
        if (skippedByConfig !== undefined && !asked) {
            planned.push({ ...base, skipped: { reason: skippedByConfig.reason, byConfig: true } });
            continue;
        }
        const line = typeof run === "string" ? run : run(stepContext(input, cwd));
        const missing = (step.needs ?? []).filter((tool) => !onPath(tool));
        if (line === null) {
            planned.push({ ...base, inline: () => Promise.resolve({ passed: true, log: "nothing to check" }) });
        } else if (typeof line !== "string") {
            planned.push({ ...base, skipped: { reason: line.skip, byConfig: false } });
        } else if (missing.length > 0) {
            planned.push({ ...base, skipped: { reason: `${missing.join(", ")} not installed`, byConfig: false } });
        } else {
            const args = asked ? (input.target?.args ?? []) : [];
            planned.push({ ...base, command: { line, cwd, ...(args.length === 0 ? {} : { args }) } });
        }
    }
    return planned;
}

export function listSteps(input: Omit<PlanInput, "target">): ListedStep[] {
    return [
        { id: GUARDS_STEP, title: guardsTitle(input) },
        ...allSteps(input.config, input.catalog).map((step) => {
            const skipped = input.config.skip.find((entry) => entry.step === step.id)?.reason;
            return {
                id: step.id,
                title: step.title,
                ...(step.args === undefined ? {} : { args: step.args }),
                ...(skipped === undefined ? {} : { skipped }),
            };
        }),
    ];
}
