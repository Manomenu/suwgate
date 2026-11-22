import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Failure, UsageError } from "./process.ts";
import { resolveSettings } from "./settings.ts";
import { parseSlowTests, parseTrx, RESULTS_FOLDER, runSlowTests, slowest } from "./slowTests.ts";
import { fakeExec, recordingIo } from "./testing.ts";

const TRX = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun id="1" name="run" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult executionId="a" testId="a" testName="Notes.Add &amp; remove" duration="00:00:00.0420000" outcome="Passed" />
    <UnitTestResult executionId="b" testId="b" testName="Notes.Wait for the server" duration="00:01:02.5000000" outcome="Passed">
      <Output><StdOut>x</StdOut></Output>
    </UnitTestResult>
    <UnitTestResult executionId="c" testId="c" testName="Notes.No duration" outcome="NotExecuted" />
  </Results>
  <TestDefinitions><UnitTest name="Notes.Add"><Execution id="a" /></UnitTest></TestDefinitions>
</TestRun>`;

const folders: string[] = [];

function repository(solutions: readonly string[]) {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-slow-tests-"));
    folders.push(root);
    for (const solution of solutions) writeFileSync(path.join(root, solution), "");
    const settings = resolveSettings({ name: "myapp", database: { up: "true" } }, {}, root);
    return { root, settings };
}

afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("dev slow-tests", () => {
    it("parses -n and refuses anything else", () => {
        expect(parseSlowTests([])).toBe(10);
        expect(parseSlowTests(["-n", "25"])).toBe(25);
        for (const args of [["-n"], ["-n", "0"], ["-n", "x"], ["25"], ["-n", "5", "6"]])
            expect(() => parseSlowTests(args)).toThrow(UsageError);
    });

    it("reads the duration and the unescaped name of every result that has them", () => {
        expect(parseTrx(TRX)).toEqual([
            { seconds: 0.042, name: "Notes.Add & remove" },
            { seconds: 62.5, name: "Notes.Wait for the server" },
        ]);
    });

    it("lists the slowest first, with the count of all tests", () => {
        expect(slowest(parseTrx(TRX), 1)).toEqual(["2 tests, the 1 slowest:", "  62.50 s  Notes.Wait for the server"]);
        expect(slowest(parseTrx(TRX), 10)).toEqual([
            "2 tests, the 2 slowest:",
            "  62.50 s  Notes.Wait for the server",
            "   0.04 s  Notes.Add & remove",
        ]);
    });

    it("builds, tests and prints the list, with the environment of checkout-env", async () => {
        const { root, settings } = repository(["Myapp.slnx"]);
        const results = path.join(root, RESULTS_FOLDER);
        const { exec, calls } = fakeExec((argv) => {
            if (argv[1] === "test") {
                writeFileSync(path.join(results, "a.trx"), TRX);
                return { stdout: "tests passed" };
            }
            return {};
        });
        const { io, out } = recordingIo();

        expect(await runSlowTests(1, { settings, env: { CI: "1" }, exec, io })).toBe(0);

        expect(out).toEqual(["2 tests, the 1 slowest:", "  62.50 s  Notes.Wait for the server"]);
        expect(calls.map((call) => call.argv.slice(0, 2).join(" "))).toEqual(["bash -c", "dotnet build", "dotnet test"]);
        expect(calls[1]?.argv).toEqual(["dotnet", "build", path.join(root, "Myapp.slnx"), "--nologo", "-v", "q"]);
        expect(calls[2]?.argv).toEqual([
            "dotnet",
            "test",
            "--solution",
            path.join(root, "Myapp.slnx"),
            "--no-build",
            "--no-progress",
            "--report-xunit-trx",
            "--results-directory",
            results,
        ]);
        expect(calls[1]?.options?.env).toMatchObject({ MSBUILDDISABLENODEREUSE: "1", E2E_DATABASE: "myapp_e2e" });
        expect(readFileSync(path.join(results, "run.log"), "utf8")).toBe("tests passed");
    });

    it("prints the list and exits 1 naming run.log when a test fails", async () => {
        const { root, settings } = repository(["Myapp.sln"]);
        const results = path.join(root, RESULTS_FOLDER);
        const { exec } = fakeExec((argv) => {
            if (argv[1] !== "test") return {};
            writeFileSync(path.join(results, "a.trx"), TRX);
            return { status: 2 };
        });
        const { io, out } = recordingIo();

        const failure = await runSlowTests(10, { settings, env: { CI: "1" }, exec, io }).catch((error: unknown) => error);

        expect(out[0]).toBe("2 tests, the 2 slowest:");
        expect(failure).toBeInstanceOf(Failure);
        expect((failure as Failure).exitCode).toBe(1);
        expect((failure as Failure).message).toContain(path.join(results, "run.log"));
    });

    it("exits 2 naming the solutions when there is none or several", async () => {
        const none = repository([]);
        const several = repository(["A.slnx", "B.sln"]);
        for (const [found, message] of [
            [none, "no .slnx or .sln"],
            [several, "2 solutions"],
        ] as const) {
            const failure = await runSlowTests(10, {
                settings: found.settings,
                env: { CI: "1" },
                exec: fakeExec().exec,
                io: recordingIo().io,
            }).catch((error: unknown) => error);
            expect((failure as Failure).exitCode).toBe(2);
            expect((failure as Failure).message).toContain(message);
        }
        expect(existsSync(path.join(several.root, RESULTS_FOLDER))).toBe(false);
    });

    it("stops with the build output when the build fails, before any test", async () => {
        const { settings } = repository(["Myapp.slnx"]);
        const { exec, calls } = fakeExec((argv) => (argv[1] === "build" ? { status: 1, stdout: "error CS0001" } : {}));
        const { io, err } = recordingIo();

        await expect(runSlowTests(10, { settings, env: { CI: "1" }, exec, io })).rejects.toThrow("dotnet build");

        expect(err).toContain("error CS0001");
        expect(calls.some((call) => call.argv[1] === "test")).toBe(false);
    });
});
