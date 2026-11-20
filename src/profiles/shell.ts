import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { StepContext } from "../gate/contract.ts";

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
