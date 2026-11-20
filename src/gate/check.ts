import { loadConfig, type Catalog } from "./config.ts";
import { plan } from "./plan.ts";
import { report } from "./report.ts";
import { changedFiles, repositoryFiles, repositoryRoot } from "./repository.ts";
import { runSteps } from "./runner.ts";

const DEFAULT_QUICK_LIMIT_SECONDS = 20;

export interface CheckOptions {
    cwd: string;
    quick: boolean;
    verbose: boolean;
    env: NodeJS.ProcessEnv;
    catalog: Catalog;
}

export interface CheckResult {
    exitCode: number;
    text: string;
}

function seconds(env: NodeJS.ProcessEnv, name: string): number | null | string {
    const value = env[name];
    if (value === undefined || value === "") return null;
    return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : `${name} must be a whole number of seconds, not '${value}'`;
}

export async function check(options: CheckOptions): Promise<CheckResult> {
    const command = `suwgate check${options.quick ? " --quick" : ""}`;
    const root = repositoryRoot(options.cwd);
    if (root === null) return { exitCode: 2, text: `${command}: ${options.cwd} is not inside a git repository` };
    const quickLimit = seconds(options.env, "SUWGATE_QUICK_LIMIT");
    const stepLimit = seconds(options.env, "SUWGATE_STEP_LIMIT");
    for (const limit of [quickLimit, stepLimit]) {
        if (typeof limit === "string") return { exitCode: 2, text: `${command}: ${limit}` };
    }
    const loaded = loadConfig(root, options.catalog);
    if ("problems" in loaded)
        return { exitCode: 2, text: [`${command}: suwgate.yml is not valid:`, ...loaded.problems.map((line) => `  ${line}`)].join("\n") };

    let changed: readonly string[] | undefined;
    const steps = plan({
        root,
        quick: options.quick,
        config: loaded.config,
        catalog: options.catalog,
        files: repositoryFiles(root),
        changed: () => (changed ??= changedFiles(root)),
    });
    const began = performance.now();
    const results = await runSteps(
        steps,
        { ...options.env, SUWGATE_ROOT: root, SUWGATE_QUICK: options.quick ? "1" : "" },
        typeof stepLimit === "number" ? stepLimit : null,
    );
    const totalSeconds = Math.round((performance.now() - began) / 1000);
    const { text, passed } = report({
        results,
        command,
        totalSeconds,
        quickLimit: options.quick
            ? typeof quickLimit === "number"
                ? quickLimit
                : (loaded.config.quickLimitSeconds ?? DEFAULT_QUICK_LIMIT_SECONDS)
            : null,
        ci: (options.env["CI"] ?? "") !== "",
        exceptions: loaded.config.exceptions.length,
        verbose: options.verbose,
    });
    return { exitCode: passed ? 0 : 1, text };
}
