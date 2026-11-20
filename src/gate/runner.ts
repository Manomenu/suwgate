import { spawn } from "node:child_process";

import type { Environment } from "./config.ts";
import type { Outcome, PlannedStep } from "./plan.ts";

const KILL_GRACE_MS = 10_000;

type Status = "pass" | "fail" | "skip";

export interface StepResult {
    step: PlannedStep;
    status: Status;
    seconds: number;
    log: string;
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
    if (pid === undefined) return;
    try {
        process.kill(-pid, signal);
    } catch {
        return;
    }
}

function matcher(pattern: string): RegExp {
    return new RegExp(`^${pattern.replaceAll("*", ".*").replaceAll("?", ".")}$`, "i");
}

function stepEnv(env: NodeJS.ProcessEnv, layers: readonly Environment[]): NodeJS.ProcessEnv {
    return layers.reduce<NodeJS.ProcessEnv>((current, layer) => {
        const cleared = (layer.unset ?? []).map(matcher);
        const kept = Object.entries(current).filter(([name]) => !cleared.some((pattern) => pattern.test(name)));
        return { ...Object.fromEntries(kept), ...layer.env };
    }, env);
}

function runCommand(
    command: { line: string; cwd: string; args?: readonly string[] },
    limitSeconds: number,
    env: NodeJS.ProcessEnv,
): Promise<Outcome> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const child = spawn("bash", ["-c", command.line, "suwgate", ...(command.args ?? [])], {
            cwd: command.cwd,
            env,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killGroup(child.pid, "SIGTERM");
            setTimeout(() => killGroup(child.pid, "SIGKILL"), KILL_GRACE_MS).unref();
        }, limitSeconds * 1000);
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({ passed: false, log: `could not start bash: ${error.message}` });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            const log = Buffer.concat(chunks).toString("utf8");
            const hung = timedOut
                ? `\nhung or too slow: exceeded ${limitSeconds} s and was killed (SUWGATE_STEP_LIMIT overrides every ceiling)`
                : "";
            resolve({ passed: code === 0 && !timedOut, log: log + hung });
        });
    });
}

export async function runSteps(steps: readonly PlannedStep[], env: NodeJS.ProcessEnv, stepLimit: number | null): Promise<StepResult[]> {
    const byId = new Map(steps.map((step) => [step.id, step]));
    const running = new Map<string, Promise<StepResult>>();

    const start = (step: PlannedStep, path: readonly string[]): Promise<StepResult> => {
        const known = running.get(step.id);
        if (known !== undefined) return known;
        if (path.includes(step.id)) throw new Error(`steps wait for each other in a circle: ${[...path, step.id].join(" -> ")}`);
        const dependencies = step.after.flatMap((id) => {
            const dependency = byId.get(id);
            return dependency === undefined ? [] : [start(dependency, [...path, step.id])];
        });
        const result = (async (): Promise<StepResult> => {
            const finished = await Promise.all(dependencies);
            if (step.skipped !== undefined) return { step, status: "skip", seconds: 0, log: step.skipped.reason };
            const failed = finished.filter((dependency) => dependency.status === "fail").map((dependency) => dependency.step.id);
            if (failed.length > 0) return { step, status: "fail", seconds: 0, log: `not run: ${failed.join(", ")} failed first` };
            const began = performance.now();
            const limit = stepLimit ?? step.limitSeconds;
            const outcome =
                step.command !== undefined
                    ? await runCommand(step.command, limit, stepEnv(env, step.environment))
                    : await (step.inline ?? (() => Promise.resolve({ passed: true, log: "" })))();
            return {
                step,
                status: outcome.passed ? "pass" : "fail",
                seconds: Math.round((performance.now() - began) / 1000),
                log: outcome.log,
            };
        })();
        running.set(step.id, result);
        return result;
    };

    return await Promise.all(steps.map((step) => start(step, [])));
}
