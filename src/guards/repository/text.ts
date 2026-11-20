import path from "node:path";

import type { Profile } from "../../gate/contract.ts";

export function baseName(file: string): string {
    return path.posix.basename(file);
}

export function lineAt(text: string, index: number): number {
    return text.slice(0, index).split("\n").length;
}

export function numberedLines(text: string): { line: number; text: string }[] {
    return text.split("\n").map((line, index) => ({ line: index + 1, text: line.replace(/\r$/, "") }));
}

export function wildcard(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`);
}

export function matchesAny(file: string, globs: readonly string[]): boolean {
    return globs.some((glob) => path.posix.matchesGlob(file, glob));
}

export function inProfileDirectory(directories: Readonly<Partial<Record<Profile, string>>>, profile: Profile, file: string): string {
    const directory = directories[profile];
    return directory === undefined ? file : `${directory.replace(/\/+$/, "")}/${file}`;
}

export function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const stringList = { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } } as const;

function withoutComments(text: string): string {
    let kept = "";
    let index = 0;
    let inString = false;
    while (index < text.length) {
        const character = text.charAt(index);
        const next = text.charAt(index + 1);
        if (inString) {
            kept += character;
            if (character === "\\") {
                kept += next;
                index += 2;
                continue;
            }
            if (character === '"') inString = false;
            index++;
        } else if (character === "/" && next === "/") {
            while (index < text.length && text.charAt(index) !== "\n") index++;
        } else if (character === "/" && next === "*") {
            const end = text.indexOf("*/", index + 2);
            index = end === -1 ? text.length : end + 2;
        } else {
            if (character === '"') inString = true;
            kept += character;
            index++;
        }
    }
    return kept;
}

export function parseJsonc(text: string): unknown {
    return parseJson(withoutComments(text).replace(/,(\s*[}\]])/g, "$1"));
}
