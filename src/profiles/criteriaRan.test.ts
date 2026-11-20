import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { StepContext } from "../gate/contract.ts";
import { criteriaRan, criteriaRanInput, criterionIds, names } from "./criteriaRan.ts";

const id = (name: string): string => ["AC", name, "1"].join("-");
const [SAVED, LISTED, OTHER] = [id("saved"), id("listed"), id("other")];

const SPEC = `<section data-role="problem"><code>${OTHER}</code></section>
<section data-role="acceptance"><ul class="checks"><li><code>${SAVED}</code> A note is saved.</li><li><code>${LISTED}</code> Notes are listed.</li></ul></section>`;

const folders: string[] = [];

function folder(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-criteria-ran-"));
    folders.push(root);
    execFileSync("git", ["init", "-q", "-b", "master"], { cwd: root });
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    return root;
}

afterEach(() => {
    for (const each of folders.splice(0)) rmSync(each, { recursive: true, force: true });
});

function context(root: string, skippedSteps: string[] = []): StepContext {
    return {
        root,
        cwd: root,
        quick: false,
        profiles: ["library", "dotnet"],
        directories: {},
        skippedSteps,
        skippedGuards: [],
        changed: () => [],
    };
}

const vitest = (...tests: [string, string][]) =>
    JSON.stringify({ testResults: [{ assertionResults: tests.map(([fullName, status]) => ({ fullName, status })) }] });

function problemsOf(root: string, skippedSteps: string[] = []): string[] {
    const input = criteriaRanInput(context(root, skippedSteps));
    if (input === null) throw new Error("no input");
    return criteriaRan({ ...input, run: path.join(root, "run") });
}

describe("criteria-ran", () => {
    it("reads the ids of the acceptance criteria only, and the ids a test names", () => {
        expect(criterionIds(SPEC)).toEqual([SAVED, LISTED]);
        expect(names(`it("${SAVED}: saves", () => {});`, SAVED, "vitest")).toBe(true);
        expect(names(`it("saves ${SAVED}", () => {});`, SAVED, "vitest")).toBe(false);
        expect(names(`[Trait("criterion", "${SAVED}")]`, SAVED, "xunit")).toBe(true);
    });

    it("passes when every criterion a test names has a test that ran and passed in this run", () => {
        const root = folder({
            "docs/visual/spec/notes.html": SPEC,
            "src/notes.test.ts": `it("${SAVED}: saves", () => {});\nit("${LISTED}: lists", () => {});\n`,
            "run/unit-tests/vitest.json": vitest([`notes ${SAVED}: saves`, "passed"], [`${LISTED}: lists`, "passed"]),
        });

        expect(problemsOf(root)).toEqual([]);
    });

    it("fails a criterion whose test was skipped, with the test and the fix", () => {
        const root = folder({
            "docs/visual/spec/notes.html": SPEC,
            "src/notes.test.ts": `it("${SAVED}: saves", () => {});\nit.skip("${LISTED}: lists", () => {});\n`,
            "run/unit-tests/vitest.json": vitest([`${SAVED}: saves`, "passed"], [`${LISTED}: lists`, "skipped"]),
        });

        expect(problemsOf(root)).toEqual([
            `${LISTED}: named by src/notes.test.ts (unit-tests), but no test naming it ran and passed in this gate run (skipped, filtered out, or failed): make that test run and pass, or skip its step in suwgate.yml (steps.skip) with a reason`,
        ]);
    });

    it("fails a criterion whose step wrote no report, and leaves out the steps suwgate.yml skips", () => {
        const root = folder({
            "docs/visual/spec/notes.html": SPEC,
            "src/notes.stories.tsx": `export const Saved = { name: "${SAVED}: saved" };\n`,
        });

        expect(problemsOf(root)[0]).toContain("(stories wrote no report)");
        expect(problemsOf(root, ["stories"])).toEqual([]);
    });

    it("reads the criterion trait of xUnit's report", () => {
        const root = folder({
            "docs/visual/spec/notes.html": SPEC,
            "App.Tests/App.Tests.csproj": '<PackageReference Include="xunit.v3" />',
            "App.Tests/NotesTests.cs": `[Trait("criterion", "${SAVED}")]`,
            "run/dotnet-test/results/a.xunit.xml": `<test name="A" result="Pass"><traits><trait name="criterion" value="${SAVED}" /></traits></test>`,
        });

        expect(problemsOf(root)).toEqual([]);
    });

    it("has nothing to check without a living spec", () => {
        expect(criteriaRanInput(context(folder({ "src/a.test.ts": "" })))).toBeNull();
    });
});
