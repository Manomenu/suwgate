import { execFileSync } from "node:child_process";

import type { Finding, Guard } from "../../gate/contract.ts";

const DEFAULT_FOLDER = /(^|\/)Database\/Migrations\/up\//;
const MAIN_BRANCHES = ["master", "origin/master"];

interface Settings {
    folders?: string[];
}

function git(root: string, args: readonly string[]): string | null {
    try {
        return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return null;
    }
}

function branchPoint(root: string): string | null {
    for (const branch of MAIN_BRANCHES) {
        const base = git(root, ["merge-base", "HEAD", branch])?.trim();
        if (base !== undefined && base.length > 0) return base;
    }
    return null;
}

function inMigrations(file: string, folders: readonly string[] | undefined): boolean {
    if (folders === undefined) return DEFAULT_FOLDER.test(file);
    return folders.some((folder) => file.startsWith(folder.endsWith("/") ? folder : `${folder}/`));
}

const CHANGED =
    "changed after master had it: restore it (git checkout master -- <file>) and add a new numbered script instead, because grate refuses to start when a script changes after it ran";

const FIXES: Readonly<Record<string, string>> = {
    M: CHANGED,
    T: CHANGED,
    D: "deleted although master has it: restore it (git checkout master -- <file>); to undo its effect add a new numbered script, because grate refuses to start when a script is missing or changed after it ran",
};

export const migrationsUnchanged: Guard = {
    id: "migrations-unchanged",
    description: "A migration script that exists on master is not changed or deleted; a new numbered script is added instead",
    profiles: ["database"],
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { folders: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } },
    },
    check(context) {
        const base = branchPoint(context.root);
        if (base === null) return [];
        const settings = (context.settings ?? {}) as Settings;
        const diff = git(context.root, ["diff", "--name-status", "--no-renames", base]) ?? "";
        const findings: Finding[] = [];
        for (const line of diff.split("\n")) {
            const [status = "", file = ""] = line.split("\t");
            const fix = FIXES[status];
            if (fix !== undefined && inMigrations(file, settings.folders)) {
                findings.push({ target: file, message: fix.replace("<file>", file) });
            }
        }
        return findings;
    },
};
