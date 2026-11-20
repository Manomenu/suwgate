import type { Finding, Guard } from "../../gate/contract.ts";
import { numberedLines, stringList } from "./text.ts";

export const MAX_AGENTS_LINES = 100;

const ACRONYMS = ["AGENTS", "CLAUDE", "CSS", "FAIL", "HTML", "HTTP", "JSON", "KISS", "PASS", "README", "SKIP", "TODO", "YAGNI", "YAML"];
const TREE = /[├└│]/;
const SHOUTING = /\b[A-Z]{4,}\b/g;

interface Settings {
    acronyms?: string[];
}

function lineCount(text: string): number {
    const lines = text.split("\n").length;
    return text.endsWith("\n") ? lines - 1 : lines;
}

function agentsFindings(text: string, acronyms: ReadonlySet<string>): Finding[] {
    const findings: Finding[] = [];
    const lines = lineCount(text);
    if (lines > MAX_AGENTS_LINES) {
        findings.push({
            target: "AGENTS.md",
            message: `${lines} lines, the limit is ${MAX_AGENTS_LINES} (it is read in every session): move detail to docs/, or make the rule a type, lint, test, guard or hook instead`,
        });
    }
    for (const { line, text: content } of numberedLines(text)) {
        if (TREE.test(content)) {
            findings.push({
                target: "AGENTS.md",
                line,
                message:
                    "a directory tree goes stale: delete it and keep the map of folders in docs/architecture.md, which repository-layout checks",
            });
        }
        for (const word of new Set(content.match(SHOUTING) ?? [])) {
            if (!acronyms.has(word)) {
                findings.push({
                    target: "AGENTS.md",
                    line,
                    message: `"${word}" shouts: write it in plain case and give the reason instead, or, if it is a real acronym, add it to settings.agents-file.acronyms in suwgate.yml`,
                });
            }
        }
    }
    return findings;
}

export const agentsFile: Guard = {
    id: "agents-file",
    description: "AGENTS.md stays short, draws no directory tree and does not shout; CLAUDE.md only points to it with @AGENTS.md",
    profiles: "every",
    settingsSchema: { type: "object", additionalProperties: false, properties: { acronyms: stringList } },
    check(context) {
        const settings = (context.settings ?? {}) as Settings;
        const acronyms = new Set([...ACRONYMS, ...(settings.acronyms ?? [])]);
        const findings = context.files.includes("AGENTS.md") ? agentsFindings(context.read("AGENTS.md"), acronyms) : [];
        if (context.files.includes("CLAUDE.md") && context.read("CLAUDE.md").trim() !== "@AGENTS.md") {
            findings.push({
                target: "CLAUDE.md",
                message: "it must contain exactly @AGENTS.md, so every agent reads the same rules: move what it says into AGENTS.md",
            });
        }
        return findings;
    },
};
