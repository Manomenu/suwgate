import { describe, expect, it } from "vitest";

import { dbArgv, databaseUrl, parseDb, runDb } from "./db.ts";
import { UsageError } from "./process.ts";
import { fakeExec, recordingIo, settingsOf } from "./testing.ts";

const COMPOSE = ["docker", "compose", "-f", "/repo/compose.yaml", "--profile", "db"];

describe("dev db: arguments", () => {
    it.each([
        [["up"], { kind: "up" }],
        [["status"], { kind: "status" }],
        [["reset"], { kind: "reset", yes: false }],
        [["reset", "--yes"], { kind: "reset", yes: true }],
        [["psql", "-d", "postgres", "-c", "select 1"], { kind: "psql", args: ["-d", "postgres", "-c", "select 1"] }],
    ])("reads %j", (args, expected) => {
        expect(parseDb(args)).toEqual(expected);
    });

    it.each([[[]], [["nope"]], [["up", "now"]], [["reset", "--force"]]])("refuses %j with the usage", (args) => {
        expect(() => parseDb(args)).toThrow(UsageError);
    });
});

describe("dev db: the commands built", () => {
    const settings = settingsOf({ name: "myapp", compose: { extraServices: ["mail"] } });

    it("starts the database and the extra services, and waits", () => {
        expect(dbArgv(settings, { kind: "up" }, true)).toEqual([...COMPOSE, "up", "-d", "--wait", "db", "mail"]);
    });

    it("asks for a terminal in psql only when there is one", () => {
        const psql = { kind: "psql", args: ["-c", "select 1"] } as const;
        expect(dbArgv(settings, psql, true)).toEqual([...COMPOSE, "exec", "db", "psql", "-U", "myapp", "-d", "myapp", "-c", "select 1"]);
        expect(dbArgv(settings, psql, false)).toContain("-T");
    });

    it("stops, resets, follows the log and lists", () => {
        expect(dbArgv(settings, { kind: "down" }, true)).toEqual([...COMPOSE, "stop", "db", "mail"]);
        expect(dbArgv(settings, { kind: "reset", yes: true }, true)).toEqual([...COMPOSE, "down", "--volumes"]);
        expect(dbArgv(settings, { kind: "logs" }, true)).toEqual([...COMPOSE, "logs", "-f", "db"]);
        expect(dbArgv(settings, { kind: "status" }, true)).toEqual([...COMPOSE, "ps", "-a", "db", "mail"]);
    });

    it("prints the address with the port of the settings", () => {
        expect(databaseUrl(settingsOf({ name: "alfusion", portOffset: 60 }))).toBe(
            "postgresql://alfusion:alfusion@localhost:5593/alfusion",
        );
    });
});

describe("dev db: running", () => {
    const settings = settingsOf();

    it("prints the address after up", async () => {
        const { exec, calls } = fakeExec();
        const { io, out } = recordingIo();
        const status = await runDb({ kind: "up" }, { settings, exec, io, interactive: true, ask: () => Promise.resolve("") });
        expect(status).toBe(0);
        expect(out).toEqual(["postgresql://myapp:myapp@localhost:5533/myapp"]);
        expect(calls[0]?.options).toEqual({ quiet: true });
    });

    it("says what to look at when up fails", async () => {
        const { exec } = fakeExec(() => ({ status: 1 }));
        const { io } = recordingIo();
        await expect(runDb({ kind: "up" }, { settings, exec, io, interactive: true, ask: () => Promise.resolve("") })).rejects.toThrow(
            "postgres did not start; see: docker compose -f /repo/compose.yaml --profile db logs db",
        );
    });

    it("deletes nothing unless the answer is y", async () => {
        const { exec, calls } = fakeExec();
        const { io, out } = recordingIo();
        const environment = { settings, exec, io, interactive: true, ask: () => Promise.resolve("n") };
        expect(await runDb({ kind: "reset", yes: false }, environment)).toBe(1);
        expect(calls).toHaveLength(0);
        expect(out).toEqual(["nothing deleted"]);
        expect(await runDb({ kind: "reset", yes: false }, { ...environment, ask: () => Promise.resolve("y") })).toBe(0);
        expect(calls).toHaveLength(1);
    });

    it("does not ask with --yes", async () => {
        const { exec, calls } = fakeExec();
        const { io } = recordingIo();
        await runDb(
            { kind: "reset", yes: true },
            { settings, exec, io, interactive: false, ask: () => Promise.reject(new Error("asked")) },
        );
        expect(calls).toHaveLength(1);
    });
});
