import type { Finding, Guard } from "../../gate/contract.ts";
import { isRecord, parseJson, stringList } from "./text.ts";

const CLAUDE_SETTINGS = ".claude/settings.json";
const PRE_COMMIT = ".githooks/pre-commit";
const EDIT_TOOLS = ["Edit", "Write"];

interface HookEntry {
    matcher: string;
    commands: string[];
}

export function matcherCovers(matcher: string, tool: string): boolean {
    if (matcher === "" || matcher === "*") return true;
    if (/^[\w\s,|-]+$/.test(matcher)) return matcher.split(/[|,]/).some((name) => name.trim() === tool);
    try {
        return new RegExp(matcher).test(tool);
    } catch {
        return false;
    }
}

function entries(settings: unknown, event: string): HookEntry[] {
    const hooks = isRecord(settings) ? settings["hooks"] : undefined;
    const list = isRecord(hooks) ? hooks[event] : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(isRecord).map((entry) => ({
        matcher: typeof entry["matcher"] === "string" ? entry["matcher"] : "",
        commands: (Array.isArray(entry["hooks"]) ? entry["hooks"] : [])
            .filter(isRecord)
            .flatMap((hook) => (typeof hook["command"] === "string" ? [hook["command"]] : [])),
    }));
}

function claudeFindings(text: string): Finding[] {
    const settings = parseJson(text);
    if (!isRecord(settings))
        return [{ target: CLAUDE_SETTINGS, message: "not valid JSON: fix it, Claude Code ignores settings it cannot read" }];
    const findings: Finding[] = [];
    if (!entries(settings, "Stop").some((entry) => entry.commands.some((command) => command.includes("hook stop")))) {
        findings.push({
            target: CLAUDE_SETTINGS,
            message:
                'no Stop hook runs suwgate hook stop, so an agent can finish a turn with a red quick gate: add { "type": "command", "command": "<suwgate> hook stop", "timeout": 600 } under hooks.Stop',
        });
    }
    const guarded = entries(settings, "PreToolUse").filter((entry) =>
        entry.commands.some((command) => command.includes("hook guard-edit")),
    );
    const unguarded = EDIT_TOOLS.filter((tool) => !guarded.some((entry) => matcherCovers(entry.matcher, tool)));
    if (unguarded.length > 0) {
        findings.push({
            target: CLAUDE_SETTINGS,
            message: `no PreToolUse hook runs suwgate hook guard-edit for ${unguarded.join(", ")}, so an agent can edit the gate: add { "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "<suwgate> hook guard-edit" }] } under hooks.PreToolUse`,
        });
    }
    return findings;
}

export const hooks: Guard = {
    id: "hooks",
    description:
        "The Claude Code hooks (suwgate hook stop, suwgate hook guard-edit) and the git hook (suwgate hook pre-commit) are wired; its settings are the edit hook's lists",
    profiles: "every",
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            protected: {
                ...stringList,
                description: "More files of this repository's gate an agent does not edit (globs, relative to the root).",
            },
            generated: {
                type: "array",
                description: "Files a command generates, which nobody edits by hand: the glob and the command that regenerates them.",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["path", "command"],
                    properties: { path: { type: "string", minLength: 1 }, command: { type: "string", minLength: 1 } },
                },
            },
            recordings: { ...stringList, description: "Globs of recorded tests: a file git tracks there is not edited by an agent." },
            migrations: { ...stringList, description: "Globs of migration scripts: one that exists is never edited, a new one is added." },
        },
    },
    check(context) {
        const findings = context.files.includes(CLAUDE_SETTINGS) ? claudeFindings(context.read(CLAUDE_SETTINGS)) : [];
        if (context.files.includes(PRE_COMMIT) && !context.read(PRE_COMMIT).includes("hook pre-commit")) {
            findings.push({
                target: PRE_COMMIT,
                message:
                    "it does not run suwgate hook pre-commit (gitleaks on the staged changes, then the quick gate): make its body exec <suwgate> hook pre-commit",
            });
        }
        return findings;
    },
};
