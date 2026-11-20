import { parse } from "yaml";

import type { Guard, GuardContext } from "../../gate/contract.ts";
import { baseName, isRecord } from "./text.ts";

const CONFIG_FILE = "suwgate.yml";

const CALLER_FILES = new Set(["justfile", "package.json", ".claude/settings.json", ".vscode/tasks.json", ".template.config/template.json"]);

export function isScript(file: string): boolean {
    return file.endsWith(".sh") || /(^|\/)scripts\/(.+\/)?[^/]+\.(ts|js|mjs|py|ps1)$/.test(file);
}

function isCaller(file: string): boolean {
    const name = baseName(file);
    return (
        CALLER_FILES.has(file) ||
        name === "package.json" ||
        name === "justfile" ||
        /\.(sh|just|csproj|proj|props|targets)$/.test(name) ||
        /^Dockerfile|\.Dockerfile$/.test(name) ||
        /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name) ||
        file === "hooks/hooks.json" ||
        file.endsWith("/hooks/hooks.json") ||
        file.startsWith(".githooks/") ||
        file.startsWith(".github/workflows/") ||
        file.startsWith(".github/actions/")
    );
}

function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    return isRecord(value) ? Object.values(value).flatMap(strings) : [];
}

function commandsOfConfig(context: GuardContext): string {
    let parsed: unknown;
    try {
        parsed = parse(context.read(CONFIG_FILE));
    } catch {
        return "";
    }
    if (!isRecord(parsed)) return "";
    const steps = isRecord(parsed["steps"]) ? parsed["steps"] : {};
    const added = Array.isArray(steps["add"]) ? steps["add"] : [];
    return [
        ...added.flatMap((step) => (isRecord(step) ? strings(step["run"]) : [])),
        ...strings(steps["configure"]),
        ...strings(parsed["env"]),
        ...strings(parsed["dev"]),
    ].join("\n");
}

function callersOf(context: GuardContext): { file: string; text: string }[] {
    const callers = context.files.filter(isCaller).map((file) => ({ file, text: context.read(file) }));
    return context.files.includes(CONFIG_FILE) ? [...callers, { file: CONFIG_FILE, text: commandsOfConfig(context) }] : callers;
}

export const scriptsCalled: Guard = {
    id: "scripts-called",
    description:
        "Every script (*.sh, and the files of a scripts/ folder) is called by a recipe, another script, a hook (also a Claude Code plugin's hooks/hooks.json), the workflow or a command of suwgate.yml (steps.add run, steps.configure, env, dev)",
    profiles: "every",
    check(context) {
        const callers = callersOf(context);
        return context.files
            .filter(isScript)
            .filter((script) => !callers.some((caller) => caller.file !== script && caller.text.includes(baseName(script))))
            .map((script) => ({
                target: script,
                message: "nothing calls it: delete it, or call it from the recipe, script, hook or workflow that needs it",
            }));
    },
};
