import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatLine, formatLog, newestLog, parseLogs, runLogs } from "./logs.ts";
import { UsageError } from "./process.ts";
import { fakeExec, recordingIo, settingsOf } from "./testing.ts";

const TRACE = "0af7651916cd43dd8448eb211c80319c";

function line(fields: Record<string, string>): string {
    return JSON.stringify({ Timestamp: "2026-01-01T10:00:00Z", LogLevel: "Information", Category: "App.Orders", Message: "m", ...fields });
}

const DEFAULTS = { all: false, trace: "", compose: false, count: 20, file: "" };

describe("dev logs: arguments", () => {
    it("has the defaults of the script", () => {
        expect(parseLogs([])).toEqual(DEFAULTS);
    });

    it("reads every option", () => {
        expect(parseLogs(["--all", "-n", "5", "--compose", "--file", "x.jsonl"])).toEqual({
            ...DEFAULTS,
            all: true,
            count: 5,
            compose: true,
            file: "x.jsonl",
        });
    });

    it("takes the traceId out of the W3C form, lower-cased, and shows every level for it", () => {
        const parsed = parseLogs(["--trace", `00-${TRACE.toUpperCase()}-b7ad6b7169203331-01`]);
        expect(parsed).toMatchObject({ trace: TRACE, all: true });
    });

    it.each([[["--trace", "abc"]], [["-n", "0"]], [["-n", "x"]], [["--nope"]]])("refuses %j", (args) => {
        expect(() => parseLogs(args)).toThrow(UsageError);
    });
});

describe("dev logs: one line each", () => {
    it("shows warnings and errors only, unless --all", () => {
        expect(formatLine(line({ LogLevel: "Information" }), { all: false, trace: "" })).toBeNull();
        expect(formatLine(line({ LogLevel: "Warning", Message: "slow" }), { all: false, trace: "" })).toBe(
            "2026-01-01T10:00:00Z Warning     App.Orders slow",
        );
        expect(formatLine(line({ LogLevel: "Information" }), { all: true, trace: "" })).toContain("Information ");
    });

    it("adds the trace and the first line of the exception, cut", () => {
        const text = formatLine(line({ LogLevel: "Error", TraceId: TRACE, Exception: `System.Boom: ${"x".repeat(300)}\n   at A.B()` }), {
            all: false,
            trace: "",
        });
        expect(text).toContain(` trace=${TRACE} m | System.Boom: `);
        expect(text).not.toContain("at A.B");
        expect(text?.split(" | ")[1]).toHaveLength(200);
    });

    it("finds the trace in the scopes, where the JSON console formatter of ASP.NET Core writes it", () => {
        const scoped = JSON.stringify({
            Timestamp: "2026-01-01T10:00:00Z",
            LogLevel: "Warning",
            Category: "App.Health",
            Message: "m",
            Scopes: [
                { Message: `SpanId:b7ad6b7169203331, TraceId:${TRACE}`, SpanId: "b7ad6b7169203331", TraceId: TRACE },
                { RequestPath: "/api/health" },
            ],
        });
        expect(formatLine(scoped, { all: false, trace: "" })).toContain(`App.Health trace=${TRACE} m`);
    });

    it("keeps a long message on one line, cut at 300 characters", () => {
        const text = formatLine(line({ LogLevel: "Error", Message: `a\n${"b".repeat(400)}` }), { all: false, trace: "" }) ?? "";
        expect(text).not.toContain("\n");
        expect(text.split("App.Orders ")[1]).toHaveLength(300);
    });

    it("keeps only the lines of one request", () => {
        const content = [line({ TraceId: TRACE, Message: "mine" }), line({ TraceId: "f".repeat(32), Message: "other" }), "not json"].join(
            "\n",
        );
        expect(formatLog(content, { ...DEFAULTS, all: true, trace: TRACE })).toHaveLength(1);
    });

    it("skips lines that are not JSON objects, and returns the last n", () => {
        const content = ["plain", "{broken", ...[1, 2, 3].map((n) => line({ LogLevel: "Error", Message: `e${n}` }))].join("\n");
        const shown = formatLog(content, { ...DEFAULTS, count: 2 });
        expect(shown.map((text) => text.split(" ").at(-1))).toEqual(["e2", "e3"]);
    });
});

describe("dev logs: where it reads", () => {
    it("takes the newest .jsonl of the log folder, and the folder of the settings", async () => {
        const root = mkdtempSync(path.join(tmpdir(), "suwgate-logs-"));
        const logs = path.join(root, ".artifacts", "logs");
        mkdirSync(logs, { recursive: true });
        writeFileSync(path.join(logs, "old.jsonl"), line({ LogLevel: "Error", Message: "old" }));
        writeFileSync(path.join(logs, "new.jsonl"), line({ LogLevel: "Error", Message: "new" }));
        utimesSync(path.join(logs, "old.jsonl"), new Date(2020, 1, 1), new Date(2020, 1, 1));
        expect(newestLog(logs)).toBe(path.join(logs, "new.jsonl"));
        expect(newestLog(path.join(root, "missing"))).toBeNull();

        const settings = { ...settingsOf(), root };
        const { io, out } = recordingIo();
        expect(await runLogs(parseLogs([]), settings, fakeExec().exec, io, root)).toBe(0);
        expect(out[0]).toBe("# .artifacts/logs/new.jsonl");
        expect(out[1]).toContain("new");
    });

    it("says how to get a log when there is none", async () => {
        const settings = { ...settingsOf(), root: mkdtempSync(path.join(tmpdir(), "suwgate-logs-")) };
        await expect(runLogs(parseLogs([]), settings, fakeExec().exec, recordingIo().io, "/")).rejects.toThrow("suwgate dev tmux start");
    });

    it("reads the compose server's log with --compose", async () => {
        const { exec, calls } = fakeExec(() => ({ stdout: line({ LogLevel: "Error", Message: "from compose" }) }));
        const { io, out } = recordingIo();
        await runLogs(parseLogs(["--compose"]), settingsOf(), exec, io, "/");
        expect(calls[0]?.argv.slice(-4)).toEqual(["logs", "--no-log-prefix", "--no-color", "server"]);
        expect(out[0]).toBe("# docker compose logs server");
        expect(out[1]).toContain("from compose");
    });
});
