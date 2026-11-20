import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import type { StepContext } from "../gate/contract.ts";

const HERE = fileURLToPath(import.meta.url);

const CLI = path.join(path.dirname(HERE), "..", `cli${path.extname(HERE)}`);

export function quoted(argument: string): string {
    return `'${argument.replaceAll("'", `'"'"'`)}'`;
}

export function changedIn(context: StepContext, pattern: RegExp): string[] {
    const prefix = path.relative(context.root, context.cwd);
    return context
        .changed()
        .filter((file) => prefix === "" || file.startsWith(`${prefix}/`))
        .map((file) => (prefix === "" ? file : file.slice(prefix.length + 1)))
        .filter((file) => pattern.test(file));
}

export function withChanged(context: StepContext, pattern: RegExp, command: string): string | null {
    const files = changedIn(context, pattern);
    return files.length === 0 ? null : `${command} ${files.map(quoted).join(" ")}`;
}

export function has(context: StepContext, file: string): boolean {
    return existsSync(path.join(context.cwd, file));
}

export function filesIn(context: StepContext, pattern: RegExp): string[] {
    return readdirSync(context.cwd)
        .filter((file) => pattern.test(file))
        .sort();
}

export function read(context: StepContext, file: string): string | null {
    try {
        return readFileSync(path.join(context.cwd, file), "utf8");
    } catch {
        return null;
    }
}

export function tracked(context: StepContext, pathspecs: readonly string[]): string[] {
    try {
        return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...pathspecs], {
            cwd: context.cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        })
            .split("\0")
            .filter((file) => file !== "" && existsSync(path.join(context.cwd, file)));
    } catch {
        return [];
    }
}

export function script(lines: readonly string[]): string {
    return lines.join("\n");
}

export function onPath(tool: string): boolean {
    return (process.env["PATH"] ?? "").split(path.delimiter).some((folder) => {
        try {
            accessSync(path.join(folder, tool), constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

export function suwgate(args: string): string {
    return `${quoted(process.execPath)} ${quoted(CLI)} ${args}`;
}

const MAX_ALIASES = 10_000;

function devSection(context: StepContext): Record<string, unknown> | null {
    try {
        const parsed: unknown = parseYaml(readFileSync(path.join(context.root, "suwgate.yml"), "utf8"), { maxAliasCount: MAX_ALIASES });
        if (typeof parsed !== "object" || parsed === null || !("dev" in parsed)) return null;
        const dev = parsed.dev;
        return typeof dev === "object" && dev !== null ? (dev as Record<string, unknown>) : {};
    } catch {
        return null;
    }
}

export function hasDevSection(context: StepContext): boolean {
    return devSection(context) !== null;
}

export function databaseUpCommand(context: StepContext): string | null {
    const database = devSection(context)?.["database"];
    const up = typeof database === "object" && database !== null ? (database as Record<string, unknown>)["up"] : undefined;
    return typeof up === "string" ? up : null;
}

export function settingsOf<Settings>(context: StepContext, step: string): Partial<Settings> {
    return context.settings[step] ?? {};
}

export const CHECKOUT_ENV = [`variables="$(${suwgate("dev checkout-env")})"`, 'eval "$variables"'];

export function runDirectory(step: string): string {
    return `run="\${SUWGATE_RUN:-$(mktemp -d)}/${step}" && mkdir -p "$run"`;
}

export function verdictCommand(args: string): string {
    return suwgate(`verdict ${args}`);
}

export function countedVitest(step: string, command: string): string {
    return [
        runDirectory(step),
        `${command} --reporter=default --reporter=json --outputFile.json="$run/vitest.json" "$@"`,
        verdictCommand(`tests vitest "$run/vitest.json" ${quoted(`vitest (${step})`)}`),
    ].join(" && ");
}

export function countedPlaywright(step: string, command: string, reporters: string | null = "list,json"): string[] {
    return [
        runDirectory(step),
        `PLAYWRIGHT_JSON_OUTPUT_FILE="$run/playwright.json" ${command}${reporters === null ? "" : ` --reporter=${reporters}`} "$@"`,
        verdictCommand(`tests playwright "$run/playwright.json" ${quoted(`playwright (${step})`)}`),
    ];
}
