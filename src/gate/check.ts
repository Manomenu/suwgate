import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";

import { loadConfig, MAX_ALIASES, type Catalog, type Config } from "./config.ts";
import type { GuardException } from "./contract.ts";
import { sameException } from "./guardsStep.ts";
import { allSteps, GUARDS_STEP, listSteps, plan, type Target } from "./plan.ts";
import { report } from "./report.ts";
import { changedFiles, fileOnMaster, repositoryFiles, repositoryRoot } from "./repository.ts";
import { runSteps } from "./runner.ts";

const DEFAULT_QUICK_LIMIT_SECONDS = 20;

export interface CheckOptions {
    cwd: string;
    quick: boolean;
    verbose: boolean;
    env: NodeJS.ProcessEnv;
    catalog: Catalog;
}

export interface StepOptions {
    cwd: string;
    id: string | undefined;
    only: boolean;
    args: readonly string[];
    verbose: boolean;
    env: NodeJS.ProcessEnv;
    catalog: Catalog;
}

export interface CheckResult {
    exitCode: number;
    text: string;
}

type Prepared = { root: string; config: Config; stepLimit: number | null; quickLimit: number | null } | CheckResult;

function seconds(env: NodeJS.ProcessEnv, name: string): number | null | string {
    const value = env[name];
    if (value === undefined || value === "") return null;
    return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : `${name} must be a whole number of seconds, not '${value}'`;
}

function prepare(command: string, cwd: string, env: NodeJS.ProcessEnv, catalog: Catalog): Prepared {
    const root = repositoryRoot(cwd);
    if (root === null) return { exitCode: 2, text: `${command}: ${cwd} is not inside a git repository` };
    const quickLimit = seconds(env, "SUWGATE_QUICK_LIMIT");
    const stepLimit = seconds(env, "SUWGATE_STEP_LIMIT");
    for (const limit of [quickLimit, stepLimit]) {
        if (typeof limit === "string") return { exitCode: 2, text: `${command}: ${limit}` };
    }
    const loaded = loadConfig(root, catalog);
    if ("problems" in loaded)
        return { exitCode: 2, text: [`${command}: suwgate.yml is not valid:`, ...loaded.problems.map((line) => `  ${line}`)].join("\n") };
    return {
        root,
        config: loaded.config,
        stepLimit: typeof stepLimit === "number" ? stepLimit : null,
        quickLimit: typeof quickLimit === "number" ? quickLimit : null,
    };
}

function mergedOnceExceptions(root: string, config: Config): GuardException[] {
    const once = config.exceptions.filter((exception) => exception.once === true);
    if (once.length === 0) return [];
    const text = fileOnMaster(root, "suwgate.yml");
    if (text === null) return [];
    let onMaster: unknown;
    try {
        onMaster = (parse(text, { maxAliasCount: MAX_ALIASES }) as { exceptions?: unknown } | null)?.exceptions;
    } catch {
        return [];
    }
    const listed = Array.isArray(onMaster) ? (onMaster as GuardException[]) : [];
    return once.filter((exception) => listed.some((other) => sameException(other, exception)));
}

async function run(
    command: string,
    prepared: Exclude<Prepared, CheckResult>,
    options: { quick: boolean; verbose: boolean; env: NodeJS.ProcessEnv; catalog: Catalog; target?: Target },
): Promise<CheckResult> {
    const { root, config } = prepared;
    let changed: readonly string[] | undefined;
    const merged = mergedOnceExceptions(root, config);
    const steps = plan({
        root,
        quick: options.quick,
        config,
        catalog: options.catalog,
        files: repositoryFiles(root),
        changed: () => (changed ??= changedFiles(root)),
        merged,
        ...(options.target === undefined ? {} : { target: options.target }),
    });
    const began = performance.now();
    const runFolder = mkdtempSync(path.join(tmpdir(), "suwgate-run-"));
    const results = await runSteps(
        steps,
        { ...options.env, SUWGATE_ROOT: root, SUWGATE_QUICK: options.quick ? "1" : "", SUWGATE_RUN: runFolder },
        prepared.stepLimit,
    ).finally(() => rmSync(runFolder, { recursive: true, force: true }));
    const totalSeconds = Math.round((performance.now() - began) / 1000);
    const { text, passed } = report({
        results,
        command,
        totalSeconds,
        quickLimit: options.quick ? (prepared.quickLimit ?? config.quickLimitSeconds ?? DEFAULT_QUICK_LIMIT_SECONDS) : null,
        ci: (options.env["CI"] ?? "") !== "",
        exceptions: config.exceptions.length,
        mergedOnce: merged.length,
        verbose: options.verbose,
    });
    return { exitCode: passed ? 0 : 1, text };
}

export async function check(options: CheckOptions): Promise<CheckResult> {
    const command = `suwgate check${options.quick ? " --quick" : ""}`;
    const prepared = prepare(command, options.cwd, options.env, options.catalog);
    if ("exitCode" in prepared) return prepared;
    return run(command, prepared, options);
}

function listing(config: Config, root: string, catalog: Catalog): string {
    const listed = listSteps({ root, quick: false, config, catalog, files: [], changed: () => [] });
    const width = Math.max(...listed.map((step) => step.id.length));
    return [
        "usage: suwgate step <id> [--only] [--verbose] [-- <arguments for the step's tool>]; the steps of this repository:",
        ...listed.map(
            (step) =>
                `  ${step.id.padEnd(width)}  ${step.title}${step.args === undefined ? "" : ` [-- args: ${step.args}]`}${step.skipped === undefined ? "" : ` [skipped in suwgate.yml: ${step.skipped}]`}`,
        ),
    ].join("\n");
}

export async function step(options: StepOptions): Promise<CheckResult> {
    const command = `suwgate step${options.id === undefined ? "" : ` ${options.id}`}`;
    const prepared = prepare(command, options.cwd, options.env, options.catalog);
    if ("exitCode" in prepared) return prepared;
    const { config, root } = prepared;
    if (options.id === undefined) return { exitCode: 0, text: listing(config, root, options.catalog) };
    const steps = allSteps(config, options.catalog);
    const chosen = steps.find((candidate) => candidate.id === options.id);
    if (chosen === undefined && options.id !== GUARDS_STEP) {
        return { exitCode: 2, text: `${command}: this repository has no step "${options.id}"\n${listing(config, root, options.catalog)}` };
    }
    if (options.args.length > 0 && chosen?.args === undefined) {
        const taking = steps
            .filter((candidate) => candidate.args !== undefined)
            .map((candidate) => `${candidate.id} (${candidate.args ?? ""})`);
        return {
            exitCode: 2,
            text: `${command}: the step ${options.id} passes no arguments to a tool, so it refuses "-- ${options.args.join(" ")}"; the steps that take them: ${taking.length === 0 ? "none here" : taking.join(", ")}`,
        };
    }
    return run(`${command}${options.only ? " --only" : ""}`, prepared, {
        quick: false,
        verbose: options.verbose,
        env: options.env,
        catalog: options.catalog,
        target: { id: options.id, only: options.only, args: options.args },
    });
}
