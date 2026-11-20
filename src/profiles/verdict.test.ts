import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { StepContext } from "../gate/contract.ts";
import { witnessed } from "./dotnet.ts";
import { dotnetGuards, requiredGuards } from "./dotnetGuards.ts";
import { countedVitest } from "./shell.ts";
import { playwrightRun, vitestRun, xunitRun } from "./reports.ts";
import { eslintVerdict, guardsVerdict, testsVerdict, tsconfigVerdict, verdict } from "./verdict.ts";

const folders: string[] = [];

function folder(files: Record<string, string> = {}): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-verdict-"));
    folders.push(root);
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text, { mode: 0o755 });
    }
    return root;
}

afterEach(() => {
    for (const each of folders.splice(0)) rmSync(each, { recursive: true, force: true });
});

const [FIRST, SECOND, THIRD] = [1, 2, 3].map((number) => ["AC", "x", String(number)].join("-"));

const PRESET = { strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true };

function stepContext(root: string, skippedGuards: string[] = [], profiles: StepContext["profiles"] = ["dotnet"]): StepContext {
    return { root, cwd: root, quick: false, profiles, directories: {}, skippedSteps: [], skippedGuards, settings: {}, changed: () => [] };
}

const FAKE_DOTNET = `#!/usr/bin/env bash
results=""
while [ $# -gt 0 ]; do
    if [ "$1" = "--results-directory" ]; then results="$2"; fi
    shift
done
mkdir -p "$results"
echo "<assemblies><assembly><collection><test name=\\"Gate.Every_guard\\" result=\\"$FAKE_RESULT\\" /></collection></assembly></assemblies>" >"$results/a.xunit.xml"
if [ "$FAKE_RESULT" = "Pass" ] && [ -n "$FAKE_GUARDS" ]; then
    mkdir -p "$SUWGATE_EVIDENCE"
    for guard in $FAKE_GUARDS; do printf '%s\\tpassed\\n' "$guard" >>"$SUWGATE_EVIDENCE/guards-1.tsv"; done
fi
`;

function runStep(command: string, cwd: string, env: Record<string, string>) {
    return spawnSync("bash", ["-c", command], {
        cwd,
        env: { ...process.env, PATH: `${path.join(cwd, "bin")}:${process.env["PATH"] ?? ""}`, SUWGATE_RUN: folder(), ...env },
        encoding: "utf8",
    });
}

describe("the reports of the test tools", () => {
    it("count what ran and keep the titles of what passed", () => {
        expect(
            vitestRun({
                testResults: [
                    {
                        assertionResults: [
                            { fullName: `a ${FIRST}: works`, status: "passed" },
                            { fullName: "b", status: "skipped" },
                        ],
                    },
                    {
                        assertionResults: [
                            { fullName: "c", status: "failed" },
                            { fullName: "d", status: "todo" },
                        ],
                    },
                ],
            }),
        ).toEqual({ executed: 2, passed: [`a ${FIRST}: works`] });
        expect(
            playwrightRun({
                suites: [
                    {
                        title: "a.e2e.ts",
                        file: "a.e2e.ts",
                        specs: [{ title: "skipped", tests: [{ status: "skipped" }] }],
                        suites: [{ title: "notes", specs: [{ title: `${SECOND}: saves`, tests: [{ status: "expected" }] }] }],
                    },
                ],
            }),
        ).toEqual({ executed: 1, passed: [`notes ${SECOND}: saves`] });
        expect(
            xunitRun(
                `<test name="A" result="Pass"><traits><trait name="criterion" value="${THIRD}" /></traits></test><test name="B" result="Skip" /><test name="C" result="Fail" />`,
            ),
        ).toEqual({ executed: 2, passed: [`${THIRD}:`] });
    });

    it("refuse a run of 0 tests, and a tool that wrote no report", () => {
        const root = folder({
            "none.json": JSON.stringify({ testResults: [{ assertionResults: [{ status: "skipped" }] }] }),
            "one.json": JSON.stringify({ testResults: [{ assertionResults: [{ status: "passed" }] }] }),
        });

        expect(testsVerdict("vitest", path.join(root, "none.json"), "vitest (unit-tests)")).toContain(
            "vitest (unit-tests) ran 0 tests (every test skipped or filtered out, or none found)",
        );
        expect(testsVerdict("vitest", path.join(root, "none.json"), "vitest")).toContain(
            "or skip the step in suwgate.yml (steps.skip) with a reason",
        );
        expect(testsVerdict("vitest", path.join(root, "one.json"), "vitest")).toBeNull();
        expect(testsVerdict("xunit", path.join(root, "results"), "dotnet test")).toContain("dotnet test wrote no report");
    });
});

describe("the evidence of the .NET guards", () => {
    it("knows exactly the guard ids of the .NET packages", () => {
        const sources = readdirSync("dotnet", { recursive: true, encoding: "utf8" }).filter(
            (file) => file.endsWith(".cs") && !file.includes("Suwgate.Tests") && !/(^|\/)(bin|obj)\//.test(file),
        );
        const ids = sources.flatMap((file) =>
            [...readFileSync(path.join("dotnet", file), "utf8").matchAll(/const string GuardId = "([^"]+)"/g)].map((match) => match[1]),
        );

        expect([...ids].sort()).toEqual(dotnetGuards.map((guard) => guard.id).sort());
    });

    it("asks for every guard of the active profiles but those suwgate.yml skips", () => {
        const all = dotnetGuards.map((guard) => guard.id);

        expect(requiredGuards(stepContext("/r", [], ["dotnet", "database"]))).toEqual(all);
        expect(requiredGuards(stepContext("/r", ["architecture/layers"]))).toEqual(
            all.filter((id) => id.startsWith("architecture/") && id !== "architecture/layers"),
        );
    });

    it("names the guards that did not run and how to wire them", () => {
        const root = folder({ "evidence/guards-7.tsv": "architecture/layers\tpassed\narchitecture/endpoints\tfailed\n" });

        expect(guardsVerdict(path.join(root, "evidence"), ["architecture/layers", "architecture/endpoints"])).toBeNull();
        const missing = guardsVerdict(path.join(root, "evidence"), ["architecture/layers", "architecture/build-settings"]) ?? "";
        expect(missing).toContain(
            "1 .NET guard(s) of the repository's profiles did not run in this gate run: architecture/build-settings.",
        );
        expect(missing).toContain("Call SuwgateGuards.VerifyAll(new GuardInputs { ... }) from one xUnit test");
        expect(missing).toContain("skipped in suwgate.yml (guards.skip) with a reason");
        expect(guardsVerdict(path.join(root, "nothing"), ["architecture/layers"])).toContain("architecture/layers");
    });

    it("fails the dotnet-test step when the VerifyAll test is deleted, or skipped with [Fact(Skip)]", () => {
        const root = folder({ "bin/dotnet": FAKE_DOTNET });
        const required = requiredGuards(stepContext(root)).join(" ");
        const command = witnessed(stepContext(root), 'dotnet test --no-build --results-directory "$run/results"');

        const wired = runStep(command, root, { FAKE_RESULT: "Pass", FAKE_GUARDS: required });
        const deleted = runStep(command, root, { FAKE_RESULT: "Pass", FAKE_GUARDS: "" });
        const skipped = runStep(command, root, { FAKE_RESULT: "Skip", FAKE_GUARDS: required });

        expect(wired.status, wired.stderr).toBe(0);
        expect(deleted.status).toBe(1);
        expect(deleted.stderr).toContain("13 .NET guard(s) of the repository's profiles did not run in this gate run");
        expect(skipped.status).toBe(1);
        expect(skipped.stderr).toContain("dotnet test ran 0 tests");
    });

    it("passes when the guards suwgate.yml skips did not run and every other did", () => {
        const root = folder({ "bin/dotnet": FAKE_DOTNET });
        const skipping = stepContext(root, ["architecture/layers", "architecture/endpoints"]);
        const command = witnessed(skipping, 'dotnet test --results-directory "$run/results"');

        const result = runStep(command, root, { FAKE_RESULT: "Pass", FAKE_GUARDS: requiredGuards(skipping).join(" ") });

        expect(result.status, result.stderr).toBe(0);
    });
});

describe("zero tests", () => {
    it("fails the unit-tests step when Vitest ran 0 tests, and passes when one ran", () => {
        const vitest = path.resolve("node_modules/.bin/vitest");
        const project = (test: string) => {
            const root = folder({ "vitest.config.mjs": "export default { test: { include: ['*.test.mjs'] } };", "a.test.mjs": test });
            symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
            return root;
        };
        const command = countedVitest("unit-tests", `${vitest} run`);

        const skippedOnly = project('import { it } from "vitest";\nit.skip("later", () => {});\n');
        const one = project('import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n');
        const none = runStep(command, skippedOnly, {});
        const ran = runStep(command, one, {});

        expect(none.status).toBe(1);
        expect(none.stderr).toContain("vitest (unit-tests) ran 0 tests");
        expect(ran.status, ran.stderr).toBe(0);
    });
});

describe("the effective configuration", () => {
    it("names a strict option that a tsconfig turns off, by what tsc --showConfig shows", () => {
        const shown = (options: object) => JSON.stringify({ compilerOptions: options });

        expect(
            tsconfigVerdict(
                "tsconfig.json",
                shown({ strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true }),
                PRESET,
            ),
        ).toBeNull();
        expect(
            tsconfigVerdict(
                "tsconfig.json",
                shown({ strict: true, strictNullChecks: false, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true }),
                PRESET,
            ),
        ).toContain("tsconfig.json: tsc --showConfig shows strictNullChecks: false");
        expect(tsconfigVerdict("tsconfig.app.json", shown({ strict: true, exactOptionalPropertyTypes: true }), PRESET)).toContain(
            'noUncheckedIndexedAccess: "unset"',
        );
    });

    it("names a rule that eslint --print-config does not show at error", () => {
        const printed = (rules: object) => JSON.stringify({ rules });
        const rules = ["suwgate/no-comments", "boundaries/dependencies"];

        expect(eslintVerdict("src/a.ts", printed({ "suwgate/no-comments": [2], "boundaries/dependencies": [2, {}] }), rules)).toBeNull();
        expect(eslintVerdict("src/a.ts", printed({ "suwgate/no-comments": [1], "boundaries/dependencies": [2] }), rules)).toContain(
            "src/a.ts: eslint --print-config shows suwgate/no-comments 1",
        );
        expect(eslintVerdict("src/a.ts", printed({ "suwgate/no-comments": "error" }), rules)).toContain('boundaries/dependencies "off"');
    });

    it("answers the steps with an exit code and the problem", () => {
        expect(verdict(["tests", "vitest", "/nowhere/vitest.json", "vitest"])).toEqual({
            exitCode: 1,
            text: "vitest wrote no report, so suwgate cannot tell that any test ran: run it again and look at its output above",
        });
        expect(verdict(["unknown"]).exitCode).toBe(2);
    });
});
