import type { Guard } from "../../gate/contract.ts";
import { baseName } from "./text.ts";

const CALLER_FILES = new Set([
    "justfile",
    "package.json",
    "suwgate.yml",
    ".claude/settings.json",
    ".vscode/tasks.json",
    ".template.config/template.json",
]);

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
        file.startsWith(".githooks/") ||
        file.startsWith(".github/workflows/") ||
        file.startsWith(".github/actions/")
    );
}

export const scriptsCalled: Guard = {
    id: "scripts-called",
    description:
        "Every script (*.sh, and the files of a scripts/ folder) is called by a recipe, another script, a hook, the workflow or suwgate.yml",
    profiles: "every",
    check(context) {
        const callers = context.files.filter(isCaller).map((file) => ({ file, text: context.read(file) }));
        return context.files
            .filter(isScript)
            .filter((script) => !callers.some((caller) => caller.file !== script && caller.text.includes(baseName(script))))
            .map((script) => ({
                target: script,
                message: "nothing calls it: delete it, or call it from the recipe, script, hook or workflow that needs it",
            }));
    },
};
