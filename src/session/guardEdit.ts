import path from "node:path";

const GATE_FILES_AT_ROOT = new Set([
    "suwgate.yml",
    ".claude/settings.json",
    ".editorconfig",
    "knip.json",
    "vitest.config.ts",
    ".changeset/config.json",
]);
const GATE_FILE_NAMES = new Set(["eslint.config.js", "eslint.config.test.js", "Directory.Build.props", "BannedSymbols.txt"]);
const GATE_FOLDERS = [".github/workflows/", ".githooks/"];
const GENERATED: Readonly<Record<string, string>> = {
    "pnpm-lock.yaml": "a generated lockfile: change package.json and run pnpm install",
    "packages.lock.json": "a generated lockfile: change Directory.Packages.props and run dotnet restore",
};

export interface Verdict {
    exitCode: 0 | 2;
    message: string;
}

const allowed: Verdict = { exitCode: 0, message: "" };

function editedPath(input: string): string | null {
    try {
        const parsed = JSON.parse(input) as { tool_input?: { file_path?: unknown; notebook_path?: unknown } };
        const file = parsed.tool_input?.file_path ?? parsed.tool_input?.notebook_path;
        return typeof file === "string" && file.length > 0 ? file.replaceAll("\\", "/") : null;
    } catch {
        return null;
    }
}

function isGate(relative: string): boolean {
    const name = path.posix.basename(relative);
    return (
        GATE_FILES_AT_ROOT.has(relative) ||
        GATE_FILE_NAMES.has(name) ||
        /^tsconfig[\w.-]*\.json$/.test(name) ||
        GATE_FOLDERS.some((folder) => relative.startsWith(folder))
    );
}

export function guardEdit(input: string, project: string, allowGateEdit: boolean): Verdict {
    const file = editedPath(input);
    const root = project.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!file?.startsWith(`${root}/`)) return allowed;
    const relative = file.slice(root.length + 1);
    if (!allowGateEdit && isGate(relative)) {
        return {
            exitCode: 2,
            message: [
                `Blocked: ${relative} is part of the gate (suwgate.yml, a hook, a lint or type config), which an agent does not change on its own.`,
                "Do not work around it: ask the user to start a session with ALLOW_GATE_EDIT=1 claude and give them the exact change to make there (the file, what to change, why).",
            ].join("\n"),
        };
    }
    const generated = GENERATED[path.posix.basename(relative)];
    return generated === undefined ? allowed : { exitCode: 2, message: `Blocked: ${relative} is ${generated}.` };
}
