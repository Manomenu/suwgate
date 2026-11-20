import { accessSync, constants } from "node:fs";
import path from "node:path";

import type { Catalog, Config } from "./config.ts";
import type { Run, Step, StepContext } from "./contract.ts";
import { runGuards } from "./guardsStep.ts";

const DEFAULT_LIMIT_SECONDS = 300;

const GUARDS_STEP = "guards";

export interface Outcome {
    passed: boolean;
    log: string;
}

export interface PlannedStep {
    id: string;
    title: string;
    after: readonly string[];
    limitSeconds: number;
    skipped?: { reason: string; byConfig: boolean };
    command?: { line: string; cwd: string };
    inline?: () => Promise<Outcome>;
}

export interface PlanInput {
    root: string;
    quick: boolean;
    config: Config;
    catalog: Catalog;
    files: readonly string[];
    changed: () => readonly string[];
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

function chosenRun(step: Step, quick: boolean): Run | undefined {
    if (!quick) return step.run;
    if (step.quick === true) return step.run;
    return step.quick;
}

function guardsStep(input: PlanInput): PlannedStep {
    const skipped = input.config.skippedGuards.map((entry) => entry.guard);
    const active = input.catalog.guards.filter(
        (guard) =>
            (guard.profiles === "every" || guard.profiles.some((profile) => input.config.profiles.includes(profile))) &&
            (!input.quick || guard.quick !== false) &&
            !skipped.includes(guard.id),
    );
    const skippedHere = input.catalog.guards.filter((guard) => skipped.includes(guard.id)).length;
    return {
        id: GUARDS_STEP,
        title: `repository guards (${active.length}${skippedHere === 0 ? "" : `, ${skippedHere} skipped in suwgate.yml`})`,
        after: [],
        limitSeconds: DEFAULT_LIMIT_SECONDS,
        inline: async () => {
            const summary = await runGuards({ root: input.root, guards: active, files: input.files, config: input.config });
            return { passed: summary.passed, log: summary.log };
        },
    };
}

export function plan(input: PlanInput): PlannedStep[] {
    const steps = [...input.catalog.stepsFor(input.config.profiles), ...addedSteps(input.config)];
    const planned: PlannedStep[] = [guardsStep(input)];
    for (const step of steps) {
        const run = chosenRun(step, input.quick);
        if (run === undefined) continue;
        const cwd = path.join(input.root, (step.profile === undefined ? undefined : input.config.directories[step.profile]) ?? "");
        const base = { id: step.id, title: step.title, after: step.after ?? [], limitSeconds: step.limitSeconds ?? DEFAULT_LIMIT_SECONDS };
        const skippedByConfig = input.config.skip.find((skipped) => skipped.step === step.id);
        if (skippedByConfig !== undefined) {
            planned.push({ ...base, skipped: { reason: skippedByConfig.reason, byConfig: true } });
            continue;
        }
        const context: StepContext = {
            root: input.root,
            cwd,
            quick: input.quick,
            profiles: input.config.profiles,
            directories: input.config.directories,
            skippedSteps: input.config.skip.map((skipped) => skipped.step),
            skippedGuards: input.config.skippedGuards.map((skipped) => skipped.guard),
            changed: input.changed,
        };
        const line = typeof run === "string" ? run : run(context);
        const missing = (step.needs ?? []).filter((tool) => !onPath(tool));
        if (line === null) {
            planned.push({ ...base, inline: () => Promise.resolve({ passed: true, log: "nothing to check" }) });
        } else if (typeof line !== "string") {
            planned.push({ ...base, skipped: { reason: line.skip, byConfig: false } });
        } else if (missing.length > 0) {
            planned.push({ ...base, skipped: { reason: `${missing.join(", ")} not installed`, byConfig: false } });
        } else {
            planned.push({ ...base, command: { line, cwd } });
        }
    }
    return planned;
}
