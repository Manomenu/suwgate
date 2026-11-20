import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PlannedStep } from "./plan.ts";
import { runSteps } from "./runner.ts";

function shell(id: string, line: string, extra: Partial<PlannedStep> = {}): PlannedStep {
    return { id, title: id, after: [], limitSeconds: 30, environment: [], command: { line, cwd: process.cwd() }, ...extra };
}

describe("the runner", () => {
    it("runs independent steps at the same time and keeps the declared order in the results", async () => {
        const meeting = (own: string) =>
            `touch "$MEETING/${own}"; until [ -e "$MEETING/a" ] && [ -e "$MEETING/b" ] && [ -e "$MEETING/c" ]; do sleep 0.05; done; echo ${own}`;
        const results = await runSteps(
            ["a", "b", "c"].map((id) => shell(id, meeting(id), { limitSeconds: 10 })),
            { ...process.env, MEETING: mkdtempSync(path.join(tmpdir(), "suwgate-runner-")) },
            null,
        );

        expect(results.map((result) => [result.step.id, result.status, result.log.trim()])).toEqual([
            ["a", "pass", "a"],
            ["b", "pass", "b"],
            ["c", "pass", "c"],
        ]);
    });

    it("starts a step only after the steps it waits for, and does not run it when one of them failed", async () => {
        const results = await runSteps(
            [
                shell("test", 'cat "$MARK"', { after: ["build"] }),
                shell("build", 'sleep 0.3; echo built > "$MARK"'),
                shell("after-red", "echo never", { after: ["red"] }),
                shell("red", "exit 3"),
            ],
            { ...process.env, MARK: `${process.env["TMPDIR"] ?? "/tmp"}/suwgate-runner-${String(process.pid)}` },
            null,
        );

        expect(results.map((result) => [result.step.id, result.status, result.log.trim()])).toEqual([
            ["test", "pass", "built"],
            ["build", "pass", ""],
            ["after-red", "fail", "not run: red failed first"],
            ["red", "fail", ""],
        ]);
    });

    it("reports a skipped step with its reason and kills a step above its ceiling", async () => {
        const results = await runSteps(
            [
                {
                    id: "skipped",
                    title: "skipped",
                    after: [],
                    limitSeconds: 5,
                    environment: [],
                    skipped: { reason: "gitleaks not installed", byConfig: false },
                },
                shell("hung", "sleep 30", { limitSeconds: 1 }),
            ],
            process.env,
            null,
        );

        expect(results[0]).toMatchObject({ status: "skip", log: "gitleaks not installed" });
        expect(results[1]?.status).toBe("fail");
        expect(results[1]?.log).toContain("hung or too slow: exceeded 1 s");
    });

    it("refuses steps that wait for each other in a circle", async () => {
        await expect(
            runSteps([shell("a", "true", { after: ["b"] }), shell("b", "true", { after: ["a"] })], process.env, null),
        ).rejects.toThrow("in a circle: a -> b -> a");
    });
});
