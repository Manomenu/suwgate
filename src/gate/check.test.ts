import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { check } from "./check.ts";
import type { Catalog } from "./config.ts";
import type { Guard, Step } from "./contract.ts";

const folders: string[] = [];

function repository(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-check-"));
    folders.push(root);
    execFileSync("git", ["init", "-q", "-b", "master"], { cwd: root });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, file), text);
    return root;
}

afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const readme: Guard = {
    id: "has-readme",
    description: "",
    profiles: "every",
    check: (context) => (context.files.includes("README.md") ? [] : [{ target: "README.md", message: "missing: add it" }]),
};
const slowGuard: Guard = {
    id: "slow",
    description: "",
    profiles: ["dotnet"],
    quick: false,
    check: () => [{ target: "x", message: "slow finding" }],
};

const steps: readonly Step[] = [
    { id: "build", title: "build", run: "echo building", quick: true },
    { id: "test", title: "test", run: "echo testing", after: ["build"] },
    {
        id: "lint",
        title: "lint changed",
        run: "echo all",
        quick: (context) => (context.changed().length === 0 ? null : `echo ${context.changed().join(" ")}`),
    },
    { id: "absent", title: "needs a missing tool", run: "true", needs: ["suwgate-no-such-tool"] },
];
const catalog: Catalog = {
    guards: [readme, slowGuard],
    dotnetGuards: [],
    stepsFor: (profiles) => (profiles.includes("web") ? [...steps] : []),
};

const run = (root: string, quick = false, env: NodeJS.ProcessEnv = {}) =>
    check({ cwd: root, quick, verbose: false, env: { PATH: process.env["PATH"], ...env }, catalog });

describe("suwgate check", () => {
    it("passes, counting the exceptions and listing the steps suwgate.yml skips with their reasons", async () => {
        const root = repository({
            "suwgate.yml": [
                "profiles: [web]",
                "steps:",
                "  skip:",
                "    - { step: absent, reason: the repository has no such tool }",
                "  add:",
                "    - { name: extra, run: echo extra, after: [test] }",
                "exceptions:",
                "  - { guard: has-readme, target: README.md, reason: the README lives in the wiki }",
            ].join("\n"),
        });

        const result = await run(root);

        expect(result.exitCode).toBe(0);
        expect(result.text).toContain("  SKIP        needs a missing tool — skipped in suwgate.yml: the repository has no such tool");
        expect(result.text).toMatch(
            /PASS suwgate check: 5 passed, total \d+s \(1 exception in suwgate\.yml; skipped in suwgate\.yml: absent\)$/,
        );
    });

    it("fails on a finding, shows it with the fix, and marks a step whose tool is missing NOT VERIFIED", async () => {
        const root = repository({ "suwgate.yml": "profiles: [web]\n" });

        const result = await run(root);

        expect(result.exitCode).toBe(1);
        expect(result.text).toContain("has-readme: README.md: missing: add it");
        expect(result.text).toContain("  FAIL ");
        expect(result.text).toContain("needs a missing tool — suwgate-no-such-tool not installed");
        expect(result.text).toContain("NOT VERIFIED: absent");
    });

    it("fails a skipped step on CI", async () => {
        const root = repository({ "suwgate.yml": "profiles: [web]\n", "README.md": "x" });

        const result = await run(root, false, { CI: "1" });

        expect(result.exitCode).toBe(1);
        expect(result.text).toContain("(CI: a skipped step fails)");
    });

    it("in --quick runs only the quick steps and guards, the changed-file steps with what changed", async () => {
        const root = repository({ "suwgate.yml": "profiles: [web]\n", "README.md": "x" });

        const result = await check({ cwd: root, quick: true, verbose: true, env: { PATH: process.env["PATH"] }, catalog });

        expect(result.exitCode).toBe(0);
        expect(result.text.split("\n").map((line) => line.replace(/\s+\d+s/, "").trim())).toEqual([
            "PASS  repository guards (1)",
            "PASS  build",
            "PASS  lint changed",
            "PASS suwgate check --quick: 3 passed, total (0 exceptions in suwgate.yml)",
        ]);
    });

    it("passes a step with nothing to check without its tool, skips a step whose run says why, and tells runs the profiles", async () => {
        const root = repository({ "suwgate.yml": "profiles: [web]\ndirectories:\n  web: app\n", "README.md": "x" });
        const seen: string[] = [];
        const contextSteps: readonly Step[] = [
            { id: "nothing", title: "nothing to check", run: () => null, needs: ["suwgate-no-such-tool"] },
            { id: "offline", title: "cannot fetch its tool", run: () => ({ skip: "no network" }) },
            {
                id: "where",
                title: "where",
                profile: "web",
                run: (context) => {
                    seen.push(`${context.profiles.join(",")} ${context.directories.web ?? ""} ${path.relative(root, context.cwd)}`);
                    return null;
                },
            },
        ];

        const result = await check({
            cwd: root,
            quick: false,
            verbose: true,
            env: { PATH: process.env["PATH"] },
            catalog: { guards: [], dotnetGuards: [], stepsFor: () => contextSteps },
        });

        expect(result.text).toMatch(/PASS +0s {2}nothing to check/);
        expect(result.text).toContain("SKIP        cannot fetch its tool — no network");
        expect(result.text).toContain("NOT VERIFIED: offline");
        expect(seen).toEqual(["web app app"]);
    });

    it("fails --quick over the budget suwgate.yml sets, and SUWGATE_QUICK_LIMIT on a machine overrides it", async () => {
        const root = repository({
            "README.md": "",
            "suwgate.yml": [
                "profiles: [web]",
                "quick:",
                "  limitSeconds: 1",
                "steps:",
                "  add:",
                "    - name: slow",
                "      run: sleep 2",
                "      quick: true",
            ].join("\n"),
        });

        const over = await run(root, true);
        expect(over.exitCode).toBe(1);
        expect(over.text).toContain("over its budget of 1s");
        expect((await run(root, true, { SUWGATE_QUICK_LIMIT: "30" })).exitCode).toBe(0);
    });

    it("exits 2 with every problem of an invalid suwgate.yml", async () => {
        const root = repository({ "suwgate.yml": "profiles: [web]\nexceptions:\n  - guard: has-readme\n    target: README.md\n" });

        const result = await run(root);

        expect(result).toEqual({
            exitCode: 2,
            text: 'suwgate check: suwgate.yml is not valid:\n  suwgate.yml:3:5: exceptions[0] has no "reason": every exception says why (reason: <why>)',
        });
    });

    it("exits 2 outside a repository with suwgate.yml", async () => {
        const root = repository({});

        expect((await run(root)).text).toContain("no suwgate.yml in");
    });
});
