import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Finding, Guard } from "../../gate/contract.ts";

export const SHARED_RULES = "AGENTS.shared.md";
export const READ_SHARED_RULES =
    "Read @AGENTS.shared.md first: the rules every repository of the stack shares. This file adds this repository's own and wins where it says otherwise.";

export function sharedRules(): string {
    return readFileSync(new URL(`../../../${SHARED_RULES}`, import.meta.url), "utf8");
}

export function writeSharedRules(root: string): "written" | "current" {
    const target = path.join(root, SHARED_RULES);
    const rules = sharedRules();
    if (existsSync(target) && readFileSync(target, "utf8") === rules) return "current";
    writeFileSync(target, rules);
    return "written";
}

function linesOutsideCode(text: string): string[] {
    const lines: string[] = [];
    let fenced = false;
    for (const line of text.split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        else if (!fenced) lines.push(line.trim());
    }
    return lines;
}

export function sharedRulesFindings(files: readonly string[], read: (file: string) => string, rules: string): Finding[] {
    const findings: Finding[] = [];
    if (!files.includes(SHARED_RULES)) {
        findings.push({
            target: SHARED_RULES,
            message: "missing: run suwgate agents-shared to write the rules every repository shares, and commit it",
        });
    } else if (read(SHARED_RULES) !== rules) {
        findings.push({
            target: SHARED_RULES,
            message:
                "differs from the copy this suwgate ships: run suwgate agents-shared to write the current one; a shared rule changes in suwgate, a rule of this repository only goes in AGENTS.md",
        });
    }
    if (files.includes("AGENTS.md") && !linesOutsideCode(read("AGENTS.md")).includes(READ_SHARED_RULES)) {
        findings.push({
            target: "AGENTS.md",
            message: `it must say, on a line of its own outside code: ${READ_SHARED_RULES} (the @ makes Claude Code load the file, the words tell every other agent to read it)`,
        });
    }
    return findings;
}

export const agentsShared: Guard = {
    id: "agents-shared",
    description: `${SHARED_RULES} is the copy of the shared rules this suwgate ships, and AGENTS.md tells every agent to read it first`,
    profiles: "every",
    check: (context) => sharedRulesFindings(context.files, (file) => context.read(file), sharedRules()),
};
