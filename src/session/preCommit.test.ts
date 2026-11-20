import { describe, expect, it } from "vitest";

import { GITLEAKS_ARGS, preCommit, runTool, type RunTool, type ToolResult } from "./preCommit.ts";

const green = () => Promise.resolve({ exitCode: 0, text: "PASS" });
const gitleaks =
    (result: Partial<ToolResult>, calls: string[] = []): RunTool =>
    (command, args) => {
        calls.push([command, ...args].join(" "));
        return Promise.resolve({ missing: false, exitCode: 0, text: "", ...result });
    };

describe("the pre-commit hook", () => {
    it("runs gitleaks on the staged changes, then the quick gate, and lets a clean commit through", async () => {
        const calls: string[] = [];
        let quickRuns = 0;

        const verdict = await preCommit("/repository", gitleaks({}, calls), () => {
            quickRuns++;
            return green();
        });

        expect(verdict).toEqual({ exitCode: 0, message: "" });
        expect(calls).toEqual([`gitleaks ${GITLEAKS_ARGS.join(" ")}`]);
        expect(quickRuns).toBe(1);
    });

    it("refuses the commit when gitleaks is missing, because a secret would go unchecked", async () => {
        const verdict = await preCommit("/repository", gitleaks({ missing: true }), green);

        expect(verdict.exitCode).toBe(1);
        expect(verdict.message).toContain("gitleaks not found");
    });

    it("refuses a staged secret with gitleaks' report and never runs the quick gate", async () => {
        let quickRuns = 0;
        const verdict = await preCommit("/repository", gitleaks({ exitCode: 1, text: "Finding: aws-access-token\n" }), () => {
            quickRuns++;
            return green();
        });

        expect(verdict.exitCode).toBe(1);
        expect(verdict.message).toContain("Finding: aws-access-token");
        expect(verdict.message).toContain("rotate it if it is real");
        expect(quickRuns).toBe(0);
    });

    it("refuses a commit while the quick gate is red, with its report", async () => {
        const verdict = await preCommit("/repository", gitleaks({}), () => Promise.resolve({ exitCode: 1, text: "FAIL lint" }));

        expect(verdict).toEqual({
            exitCode: 1,
            message: "FAIL lint\npre-commit: the quick gate is red (above): fix it before committing; commit refused",
        });
    });

    it("tells a missing tool from a failing one", async () => {
        expect(await runTool("suwgate-no-such-tool", [], process.cwd())).toMatchObject({ missing: true });
        expect(await runTool("node", ["-e", "process.stderr.write('bad'); process.exit(3)"], process.cwd())).toEqual({
            missing: false,
            exitCode: 3,
            text: "bad",
        });
    });
});
