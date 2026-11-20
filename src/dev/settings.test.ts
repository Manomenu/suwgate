import { describe, expect, it } from "vitest";

import { Failure } from "./process.ts";
import { BASE_PORTS, DEFAULT_SMOKE_CHECKS, needServerProject, needWebDirectory, resolveSettings } from "./settings.ts";
import { settingsOf } from "./testing.ts";

function problemsOf(raw: unknown, directories: Record<string, unknown> = {}): string {
    try {
        resolveSettings(raw, directories, "/repo");
    } catch (error) {
        if (error instanceof Failure) return error.message;
    }
    return "";
}

describe("dev settings", () => {
    it("fills every default from the name alone", () => {
        const settings = settingsOf();
        expect(settings.ports).toEqual(BASE_PORTS);
        expect(settings.compose).toEqual({
            file: "compose.yaml",
            profile: "db",
            databaseService: "db",
            serverService: "server",
            extraServices: [],
        });
        expect(settings.database).toEqual({ user: "myapp", password: "myapp", name: "myapp" });
        expect(settings.logFile).toBe(".artifacts/logs/server.jsonl");
        expect(settings.smokeChecks).toEqual(DEFAULT_SMOKE_CHECKS);
        expect(settings.serverProject).toBe("Myapp.Server");
        expect(settings.webDirectory).toBe("Myapp.Web");
    });

    it.each([
        [60, { server: 6360, web: 3360, e2eServer: 6361, e2eWeb: 3361, database: 5593, stack: 8250 }],
        [-70, { server: 6230, web: 3230, e2eServer: 6231, e2eWeb: 3231, database: 5463, stack: 8120 }],
    ])("moves every port by the port offset %i, as the repositories made from the template did by hand", (offset, expected) => {
        expect(settingsOf({ name: "x", portOffset: offset }).ports).toEqual(expected);
    });

    it("lets one port be set apart from the offset", () => {
        expect(settingsOf({ name: "x", portOffset: 60, ports: { database: 5000 } }).ports).toMatchObject({ database: 5000, server: 6360 });
    });

    it("takes the database names and extra services from the settings", () => {
        const settings = settingsOf({
            name: "alfusion",
            compose: { extraServices: ["mail"], file: "docker/compose.yaml" },
            database: { user: "u", password: "p", name: "d" },
            server: { project: "Other.Server", logFile: "logs/s.jsonl" },
        });
        expect(settings.compose.extraServices).toEqual(["mail"]);
        expect(settings.compose.file).toBe("docker/compose.yaml");
        expect(settings.database).toEqual({ user: "u", password: "p", name: "d" });
        expect(settings.serverProject).toBe("Other.Server");
        expect(settings.logFile).toBe("logs/s.jsonl");
    });

    it.each([
        [undefined, "no dev section"],
        [{}, "dev.name is missing"],
        [{ name: "My App" }, 'dev.name "My App" must be lower-case'],
        [{ name: "x", unknown: 1 }, "dev.unknown is not a setting"],
        [{ name: "x", ports: { server: "6300" } }, "dev.ports.server must be an integer"],
        [{ name: "x", portOffset: 70000 }, "outside 1-65535: lower dev.portOffset"],
        [{ name: "x", compose: { extraServices: "mail" } }, "dev.compose.extraServices must be a list"],
        [{ name: "x", smoke: { checks: [{ path: "healthz", expect: "ok", hint: "h" }] } }, "path must start with /"],
        [{ name: "x", smoke: { checks: [{ path: "/h", expect: "(", hint: "h" }] } }, "is not a regular expression"],
        [{ name: "x", smoke: { checks: [] } }, "non-empty list"],
    ])("refuses %j and says what to fix", (raw, message) => {
        expect(problemsOf(raw)).toContain(message);
    });

    it("says how to fix a missing server project or web folder", () => {
        const settings = resolveSettings({ name: "x" }, {}, "/repo");
        expect(() => needServerProject(settings)).toThrow("directories.dotnet");
        expect(() => needWebDirectory(settings)).toThrow("directories.web");
    });
});
