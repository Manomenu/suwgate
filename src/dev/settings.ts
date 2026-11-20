import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { Failure } from "./process.ts";

export interface SmokeCheck {
    path: string;
    expect: string;
    hint: string;
}

export interface DevSettings {
    root: string;
    name: string;
    ports: { server: number; web: number; e2eServer: number; e2eWeb: number; database: number; stack: number };
    compose: { file: string; profile: string; databaseService: string; serverService: string; extraServices: string[] };
    database: { user: string; password: string; name: string; up: string | null; psql: string | null };
    serverProject: string | null;
    dotnetDirectory: string | null;
    webDirectory: string | null;
    logFile: string;
    smokeChecks: SmokeCheck[];
}

export const BASE_PORTS = { server: 6300, web: 3300, e2eServer: 6301, e2eWeb: 3301, database: 5533, stack: 8190 } as const;

export const DEFAULT_SMOKE_CHECKS: readonly SmokeCheck[] = [
    { path: "/healthz", expect: "^ok", hint: "nginx in the web container does not answer: docker compose ps, docker compose logs web." },
    {
        path: "/api/health",
        expect: '"status":"ok"',
        hint: "the page reaches nginx but not a healthy server with its database: docker compose logs server, check ConnectionStrings__Default.",
    },
];

const NAME = /^[a-z][a-z0-9-]*$/;
const MAX_ALIASES = 10_000;
const ROOT_KEYS = ["name", "portOffset", "ports", "compose", "database", "server", "smoke"];
const PORT_KEYS = Object.keys(BASE_PORTS);
const COMPOSE_KEYS = ["file", "profile", "databaseService", "serverService", "extraServices"];
const DATABASE_KEYS = ["user", "password", "name", "up", "psql"];
const SERVER_KEYS = ["project", "logFile"];
const SMOKE_KEYS = ["checks"];
const CHECK_KEYS = ["path", "expect", "hint"];
const PORT_RANGE = { min: 1, max: 65535 };

type Problems = string[];

function section(value: unknown, where: string, keys: readonly string[], problems: Problems): Record<string, unknown> {
    if (value === undefined) return {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push(`${where} must be a mapping`);
        return {};
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (!keys.includes(key)) problems.push(`${where}.${key} is not a setting of suwgate dev: the settings are ${keys.join(", ")}`);
    }
    return record;
}

function text(record: Record<string, unknown>, key: string, where: string, fallback: string, problems: Problems): string {
    const value = record[key];
    if (value === undefined) return fallback;
    if (typeof value === "string" && value.trim() !== "") return value;
    problems.push(`${where}.${key} must be a non-empty string`);
    return fallback;
}

function whole(record: Record<string, unknown>, key: string, where: string, fallback: number, problems: Problems): number {
    const value = record[key];
    if (value === undefined) return fallback;
    if (typeof value === "number" && Number.isInteger(value)) return value;
    problems.push(`${where}.${key} must be an integer`);
    return fallback;
}

function list(record: Record<string, unknown>, key: string, where: string, problems: Problems): string[] {
    const value = record[key];
    if (value === undefined) return [];
    if (Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "")) return value as string[];
    problems.push(`${where}.${key} must be a list of names`);
    return [];
}

function smokeChecks(raw: unknown, problems: Problems): SmokeCheck[] {
    const smoke = section(raw, "dev.smoke", SMOKE_KEYS, problems);
    const checks = smoke["checks"];
    if (checks === undefined) return [...DEFAULT_SMOKE_CHECKS];
    if (!Array.isArray(checks) || checks.length === 0) {
        problems.push("dev.smoke.checks must be a non-empty list of {path, expect, hint}");
        return [];
    }
    return checks.map((check: unknown, index) => {
        const where = `dev.smoke.checks[${index}]`;
        const record = section(check, where, CHECK_KEYS, problems);
        const expect = text(record, "expect", where, "", problems);
        try {
            new RegExp(expect, "m");
        } catch {
            problems.push(`${where}.expect is not a regular expression: ${expect}`);
        }
        const checkPath = text(record, "path", where, "", problems);
        if (!checkPath.startsWith("/")) problems.push(`${where}.path must start with /`);
        return { path: checkPath, expect, hint: text(record, "hint", where, "", problems) };
    });
}

export function resolveSettings(raw: unknown, directories: Readonly<Record<string, unknown>>, root: string): DevSettings {
    if (raw === undefined) {
        throw new Failure(
            "suwgate.yml has no dev section: add `dev:` with at least `name: <short lower-case name of the app>` (see docs/dev.md)",
            2,
        );
    }
    const problems: Problems = [];
    const top = section(raw, "dev", ROOT_KEYS, problems);
    const name = text(top, "name", "dev", "", problems);
    if (top["name"] === undefined)
        problems.push("dev.name is missing: the short lower-case name of the app (it names the tmux session and the database)");
    else if (!NAME.test(name)) problems.push(`dev.name "${name}" must be lower-case letters, digits and dashes, starting with a letter`);
    const offset = whole(top, "portOffset", "dev", 0, problems);
    const portsRaw = section(top["ports"], "dev.ports", PORT_KEYS, problems);
    const ports = Object.fromEntries(
        Object.entries(BASE_PORTS).map(([key, base]) => [key, whole(portsRaw, key, "dev.ports", base + offset, problems)]),
    ) as DevSettings["ports"];
    for (const [key, port] of Object.entries(ports)) {
        if (port < PORT_RANGE.min || port > PORT_RANGE.max) {
            problems.push(
                `port ${key} is ${port}, outside ${PORT_RANGE.min}-${PORT_RANGE.max}: lower dev.portOffset or set dev.ports.${key}`,
            );
        }
    }
    const composeRaw = section(top["compose"], "dev.compose", COMPOSE_KEYS, problems);
    const databaseRaw = section(top["database"], "dev.database", DATABASE_KEYS, problems);
    const user = text(databaseRaw, "user", "dev.database", name, problems);
    const serverRaw = section(top["server"], "dev.server", SERVER_KEYS, problems);
    const settings: DevSettings = {
        root,
        name,
        ports,
        compose: {
            file: text(composeRaw, "file", "dev.compose", "compose.yaml", problems),
            profile: text(composeRaw, "profile", "dev.compose", "db", problems),
            databaseService: text(composeRaw, "databaseService", "dev.compose", "db", problems),
            serverService: text(composeRaw, "serverService", "dev.compose", "server", problems),
            extraServices: list(composeRaw, "extraServices", "dev.compose", problems),
        },
        database: {
            user,
            password: text(databaseRaw, "password", "dev.database", user, problems),
            name: text(databaseRaw, "name", "dev.database", name, problems),
            up: databaseRaw["up"] === undefined ? null : text(databaseRaw, "up", "dev.database", "", problems),
            psql: databaseRaw["psql"] === undefined ? null : text(databaseRaw, "psql", "dev.database", "", problems),
        },
        serverProject: serverRaw["project"] === undefined ? null : text(serverRaw, "project", "dev.server", "", problems),
        dotnetDirectory: stringOrNull(directories["dotnet"]),
        webDirectory: stringOrNull(directories["web"]),
        logFile: text(serverRaw, "logFile", "dev.server", ".artifacts/logs/server.jsonl", problems),
        smokeChecks: smokeChecks(top["smoke"], problems),
    };
    if (problems.length > 0) {
        throw new Failure(`suwgate.yml: ${problems.join("\n  suwgate.yml: ")}`, 2);
    }
    return settings;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

export function loadSettings(root: string): DevSettings {
    const file = path.join(root, "suwgate.yml");
    if (!existsSync(file)) throw new Failure(`no suwgate.yml in ${root}: suwgate dev reads its settings from the dev section there`, 2);
    const data = (parse(readFileSync(file, "utf8"), { maxAliasCount: MAX_ALIASES }) ?? {}) as Record<string, unknown>;
    const directories =
        typeof data["directories"] === "object" && data["directories"] !== null ? (data["directories"] as Record<string, unknown>) : {};
    return resolveSettings(data["dev"], directories, root);
}

const WEB_SDK = /\bSdk\s*=\s*"Microsoft\.NET\.Sdk\.Web[/"]|<Sdk\s+Name\s*=\s*"Microsoft\.NET\.Sdk\.Web"/;
const NOT_SOURCES = new Set(["node_modules", "bin", "obj"]);

function webProjects(root: string, folder: string): string[] {
    let entries;
    try {
        entries = readdirSync(path.join(root, folder), { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.flatMap((entry) => {
        const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
        if (entry.isDirectory()) return entry.name.startsWith(".") || NOT_SOURCES.has(entry.name) ? [] : webProjects(root, relative);
        return entry.name.endsWith(".csproj") && WEB_SDK.test(readFileSync(path.join(root, relative), "utf8")) ? [relative] : [];
    });
}

export function needServerProject(settings: DevSettings): string {
    if (settings.serverProject !== null) return settings.serverProject;
    const under = settings.dotnetDirectory ?? "";
    const found = webProjects(settings.root, under.replace(/^\.\/?|\/+$/g, "")).sort();
    const [project] = found;
    if (project !== undefined && found.length === 1) return path.posix.dirname(project);
    const where = under === "" ? "the repository" : under;
    throw new Failure(
        found.length === 0
            ? `no server project: no .csproj in ${where} uses Sdk="Microsoft.NET.Sdk.Web"; set dev.server.project in suwgate.yml to the folder of the server's .csproj`
            : `${found.length} server projects use Sdk="Microsoft.NET.Sdk.Web" (${found.join(", ")}): set dev.server.project in suwgate.yml to the folder of the one suwgate dev server runs`,
        2,
    );
}

export function needWebDirectory(settings: DevSettings): string {
    if (settings.webDirectory === null) {
        throw new Failure("no web app folder: set directories.web in suwgate.yml to the folder of the web app's package.json", 2);
    }
    return settings.webDirectory;
}
