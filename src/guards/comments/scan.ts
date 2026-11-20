import path from "node:path";

import type { Finding, Guard, Profile } from "../../gate/contract.ts";

export interface FoundComment {
    line: number;
    text: string;
}

export const CRITERION_ID = "AC-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]+";

const FIX =
    'delete it; rename or split the code so it explains itself; put lasting knowledge in a test, the README, AGENTS.md or docs/ (the only comments allowed are the tool directives listed in AGENTS.md, "No comments")';

const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "packages.lock.json"]);
const SKIPPED_FOLDERS = [
    "node_modules/",
    "dist/",
    "bin/",
    "obj/",
    ".artifacts/",
    ".changeset/",
    "docs/",
    "storybook-static/",
    "visual/snapshots/",
];

export function fileName(file: string): string {
    return path.posix.basename(file);
}

export function isScanned(file: string): boolean {
    return !LOCKFILES.has(fileName(file)) && !SKIPPED_FOLDERS.some((folder) => file.startsWith(folder) || file.includes(`/${folder}`));
}

function endOfString(text: string, opening: number, quote: string): number {
    for (let at = opening + 1; at < text.length; at++) {
        if (text[at] === "\\") at++;
        else if (text[at] === quote) return at + 1;
    }
    return text.length;
}

export function lineBreaks(text: string, start: number, end: number): number {
    return text.slice(start, end).split("\n").length - 1;
}

export function scan(text: string, lineComment: string | null, quotes: string, blockStart = "/*", blockEnd = "*/"): FoundComment[] {
    const found: FoundComment[] = [];
    let line = 1;
    let at = 0;
    while (at < text.length) {
        const sign = text.charAt(at);
        if (sign === "\n") {
            line++;
            at++;
        } else if (quotes.includes(sign)) {
            const end = endOfString(text, at, sign);
            line += lineBreaks(text, at, end);
            at = end;
        } else if (lineComment !== null && text.startsWith(lineComment, at)) {
            const newline = text.indexOf("\n", at);
            const end = newline < 0 ? text.length : newline;
            found.push({ line, text: text.slice(at, end).trim() });
            at = end;
        } else if (text.startsWith(blockStart, at)) {
            const close = text.indexOf(blockEnd, at + blockStart.length);
            const end = close < 0 ? text.length : close + blockEnd.length;
            found.push({ line, text: text.slice(at, end).trim() });
            line += lineBreaks(text, at, end);
            at = end;
        } else {
            at++;
        }
    }
    return found;
}

function shown(comment: FoundComment): string {
    const first = (comment.text.split("\n")[0] ?? "").trim();
    return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

function commentFinding(file: string, comment: FoundComment): Finding {
    return { target: file, line: comment.line, message: `comment "${shown(comment)}": ${FIX}` };
}

interface CommentGuard {
    id: string;
    description: string;
    profiles: readonly Profile[] | "every";
    scans(file: string): boolean;
    commentsIn(file: string, text: string): readonly FoundComment[];
}

export function commentGuard(guard: CommentGuard): Guard {
    return {
        id: guard.id,
        description: guard.description,
        profiles: guard.profiles,
        check: (context) =>
            context.files
                .filter((file) => isScanned(file) && guard.scans(file))
                .flatMap((file) => guard.commentsIn(file, context.read(file)).map((comment) => commentFinding(file, comment))),
    };
}
