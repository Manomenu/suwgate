import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Finding, Guard, GuardContext } from "../../gate/contract.ts";
import { numberedLines } from "./text.ts";

const MAP = "docs/architecture.md";
export const MAX_MAP_LINE_LENGTH = 300;
const MAP_ENTRY = /^- `([^`]+)`/;
const MAP_HEADING = "## The map";

function mapSection(text: string): { line: number; text: string }[] | null {
    const lines = numberedLines(text);
    const start = lines.findIndex(({ text: line }) => line.trim() === MAP_HEADING);
    if (start === -1) return null;
    const end = lines.findIndex(({ text: line }, index) => index > start && /^#{1,2} /.test(line));
    return lines.slice(start + 1, end === -1 ? undefined : end);
}

function mapFindings(context: GuardContext): Finding[] {
    const section = mapSection(context.read(MAP));
    if (section === null) {
        return [
            {
                target: MAP,
                message: `no "${MAP_HEADING}" section: add it, with one line per top-level folder (- \`folder/\` — what it holds)`,
            },
        ];
    }
    const entries = section.filter(({ text }) => MAP_ENTRY.test(text));
    const folders = new Set(context.files.filter((file) => file.includes("/")).map((file) => file.split("/")[0] ?? ""));
    const described = new Map(entries.map(({ line, text }) => [(MAP_ENTRY.exec(text)?.[1] ?? "").split("/")[0] ?? "", line]));
    const missing = [...folders]
        .filter((folder) => !described.has(folder))
        .sort()
        .map((folder) => ({
            target: `${folder}/`,
            message: `add a line for it to the map in ${MAP}: - \`${folder}/\` — what it holds and why it is a folder of its own`,
        }));
    const stale = [...described]
        .filter(([entry]) => !folders.has(entry) && !context.files.includes(entry) && !existsSync(path.join(context.root, entry)))
        .map(([entry, line]) => ({ target: MAP, line, message: `the map names ${entry}, which does not exist: delete its line` }));
    const tooLong = entries
        .filter(({ text }) => text.length > MAX_MAP_LINE_LENGTH)
        .map(({ line, text }) => ({
            target: MAP,
            line,
            message: `${text.length} characters, the limit is ${MAX_MAP_LINE_LENGTH}: shorten the line, the map says what a folder holds, not how it works`,
        }));
    return [...missing, ...stale, ...tooLong];
}

function caseClashes(files: readonly string[]): Finding[] {
    const seen = new Map<string, string>();
    const findings: Finding[] = [];
    for (const file of files) {
        const other = seen.get(file.toLowerCase());
        if (other !== undefined) {
            findings.push({
                target: file,
                message: `differs from ${other} only in letter case, which Windows and macOS ignore: rename one of them`,
            });
        }
        seen.set(file.toLowerCase(), file);
    }
    return findings;
}

function notExecutable(root: string): Finding[] {
    let staged: string;
    try {
        staged = execFileSync("git", ["ls-files", "--stage", "-z", "--", "*.sh", ".githooks/*"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
    } catch {
        return [];
    }
    return staged
        .split("\0")
        .filter((entry) => entry.length > 0 && !entry.startsWith("100755"))
        .map((entry) => entry.split("\t")[1] ?? entry)
        .map((file) => ({ target: file, message: `not executable in git: run git update-index --chmod=+x ${file}` }));
}

export const repositoryLayout: Guard = {
    id: "repository-layout",
    description:
        "Every top-level folder has a short line in the map (the section ## The map) of docs/architecture.md, no two files differ only in letter case, and every shell script is executable in git",
    profiles: "every",
    check(context) {
        return [
            ...(context.files.includes(MAP) ? mapFindings(context) : []),
            ...caseClashes(context.files),
            ...notExecutable(context.root),
        ];
    },
};
