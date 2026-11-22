import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
        const settings = resolveSettings({ name: "myapp" }, { web: "Myapp.Web" }, "/repo");
        expect(settings.ports).toEqual(BASE_PORTS);
        expect(settings.compose).toEqual({
            file: "compose.yaml",
            profile: "db",
            databaseService: "db",
            serverService: "server",
            extraServices: [],
        });
        expect(settings.database).toEqual({ user: "myapp", password: "myapp", name: "myapp", up: null, psql: null });
        expect(settings.logFile).toBe(".artifacts/logs/server.jsonl");
        expect(settings.smokeChecks).toEqual(DEFAULT_SMOKE_CHECKS);
        expect(settings.serverProject).toBeNull();
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
        expect(settings.database).toEqual({ user: "u", password: "p", name: "d", up: null, psql: null });
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
        [{ name: "x", siblings: { cms: { checkout: "../cms" } } }, "dev.siblings.cms.images is missing"],
        [{ name: "x", siblings: { cms: null } }, "dev.siblings.cms.images is missing"],
        [{ name: "x", siblings: { cms: { images: [] } } }, "dev.siblings.cms.images must name at least one image"],
        [{ name: "x", siblings: { Cms: { images: ["cms:local"] } } }, 'the name "Cms" must be lower-case letters'],
        [{ name: "x", siblings: { cms: { images: ["cms:local"], health: "localhost:8225" } } }, "must be an http:// or https:// address"],
        [{ name: "x", siblings: { cms: { images: ["cms:local"], port: 1 } } }, "dev.siblings.cms.port is not a setting"],
        [{ name: "x", siblings: ["cms"] }, "dev.siblings must be a mapping"],
    ])("refuses %j and says what to fix", (raw, message) => {
        expect(problemsOf(raw)).toContain(message);
    });

    it("reads a sibling with its defaults: the checkout next to the repository, built with docker compose build", () => {
        expect(settingsOf({ name: "chat", siblings: { cms: { images: ["cms:local"] } } }).siblings).toEqual([
            { name: "cms", checkout: "/cms", build: "docker compose build", images: ["cms:local"], compose: null, health: null },
        ]);
        expect(settingsOf().siblings).toEqual([]);
    });

    it("says how to fix a missing web folder", () => {
        expect(() => needWebDirectory(resolveSettings({ name: "x" }, {}, "/repo"))).toThrow("directories.web");
    });
});

const WEB = '<Project Sdk="Microsoft.NET.Sdk.Web">\n</Project>\n';
const LIBRARY = '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n';

function repository(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-server-project-"));
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    return root;
}

function serverProjectOf(files: Record<string, string>, directories: Record<string, unknown> = {}): string {
    return needServerProject(resolveSettings({ name: "x" }, directories, repository(files)));
}

describe("dev settings: the server project", () => {
    it("takes dev.server.project as it is", () => {
        expect(needServerProject(resolveSettings({ name: "x", server: { project: "Other.Server" } }, {}, "/repo"))).toBe("Other.Server");
    });

    it("finds the one project on the web SDK when suwgate.yml names none", () => {
        const files = {
            "Myapp.Server/Myapp.Server.csproj": WEB,
            "Myapp.Server.Tests/Myapp.Server.Tests.csproj": LIBRARY,
            "Myapp.Web/node_modules/pkg/Sample.csproj": WEB,
            "Myapp.Server/bin/Debug/Copy.csproj": WEB,
        };

        expect(serverProjectOf(files)).toBe("Myapp.Server");
    });

    it("finds it below directories.dotnet, also with the SDK as an element", () => {
        const files = {
            "src/Api/Api.csproj": '<Project>\n  <Sdk Name="Microsoft.NET.Sdk.Web" />\n</Project>\n',
            "tools/Other.csproj": WEB,
        };

        expect(serverProjectOf(files, { dotnet: "src" })).toBe("src/Api");
    });

    it("names every candidate and the setting when several projects are on the web SDK", () => {
        const files = { "Chat.Server/Chat.Server.csproj": WEB, "Chat.Tenant/Chat.Tenant.csproj": WEB };

        expect(() => serverProjectOf(files)).toThrow(
            '2 server projects use Sdk="Microsoft.NET.Sdk.Web" (Chat.Server/Chat.Server.csproj, Chat.Tenant/Chat.Tenant.csproj): set dev.server.project',
        );
    });

    it("names the setting when no project is on the web SDK", () => {
        expect(() => serverProjectOf({ "Lib/Lib.csproj": LIBRARY })).toThrow(
            'no server project: no .csproj in the repository uses Sdk="Microsoft.NET.Sdk.Web"; set dev.server.project in suwgate.yml',
        );
    });

    it("refuses an empty dev.server.project", () => {
        expect(problemsOf({ name: "x", server: { project: "" } })).toContain("dev.server.project must be a non-empty string");
    });
});
