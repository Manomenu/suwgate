import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface EditHookSettings {
    protected?: string[];
    generated?: { path: string; command: string }[];
    recordings?: string[];
    migrations?: string[];
}

export interface EditHookProject {
    root: string;
    profiles: readonly string[];
    settings: EditHookSettings;
}

interface Lists {
    gate: readonly string[];
    generated: Readonly<Record<string, string>>;
    recordings: readonly string[];
    migrations: readonly string[];
}

const NODE_GATE = [
    "**/eslint.config.{js,mjs,ts}",
    "**/eslint.config.test.js",
    "**/tsconfig*.json",
    "**/vitest.config.ts",
    "**/playwright.config.ts",
    "**/knip.json",
    "**/knip.config.{ts,js}",
    "**/.prettierrc.json",
    "**/prettier.config.{js,mjs,ts}",
];

const LISTS: Readonly<Record<string, Partial<Lists>>> = {
    every: {
        gate: ["suwgate.yml", "criteria.json", ".claude/settings.json", ".github/workflows/**", ".githooks/**", "**/.editorconfig"],
        generated: { "**/pnpm-lock.yaml": "a generated lockfile: change package.json and run pnpm install" },
    },
    web: {
        gate: NODE_GATE,
        generated: {
            "**/openapi.d.ts": "generated from the server's API contract: regenerate it with the command that generates the API types",
        },
    },
    library: { gate: [...NODE_GATE, ".changeset/config.json", "**/.storybook/**"] },
    dotnet: {
        gate: ["**/Directory.Build.props", "**/Directory.Build.targets", "**/BannedSymbols.txt", "**/layers.json"],
        generated: {
            "**/packages.lock.json": "a generated lockfile: change Directory.Packages.props and run dotnet restore",
            "**/contract/openapi.json":
                "generated from the server's endpoints: regenerate it with the command that generates the API contract",
        },
        recordings: ["**/Characterization/**"],
    },
    database: { migrations: ["**/Database/Migrations/up/**"] },
};

export interface Verdict {
    exitCode: 0 | 2;
    message: string;
}

const allowed: Verdict = { exitCode: 0, message: "" };
const ASK_THE_OWNER =
    "Do not work around it: ask the user to start a session with ALLOW_GATE_EDIT=1 claude and give them the exact change to make there (the file, what to change, why).";

function editedPath(input: string): string | null {
    try {
        const parsed = JSON.parse(input) as { tool_input?: { file_path?: unknown; notebook_path?: unknown } };
        const file = parsed.tool_input?.file_path ?? parsed.tool_input?.notebook_path;
        return typeof file === "string" && file.length > 0 ? path.posix.normalize(file.replaceAll("\\", "/")) : null;
    } catch {
        return null;
    }
}

function listsOf(project: EditHookProject): Lists {
    const parts = ["every", ...project.profiles].map((name) => LISTS[name] ?? {});
    const { settings } = project;
    return {
        gate: [...parts.flatMap((part) => part.gate ?? []), ...(settings.protected ?? [])],
        generated: Object.assign(
            {},
            ...parts.map((part) => part.generated ?? {}),
            ...(settings.generated ?? []).map((entry) => ({
                [entry.path]: `generated: regenerate it with ${entry.command} instead of editing it`,
            })),
        ) as Record<string, string>,
        recordings: [...parts.flatMap((part) => part.recordings ?? []), ...(settings.recordings ?? [])],
        migrations: [...parts.flatMap((part) => part.migrations ?? []), ...(settings.migrations ?? [])],
    };
}

function matches(relative: string, globs: readonly string[]): boolean {
    return globs.some((glob) => path.posix.matchesGlob(relative, glob));
}

function isTracked(root: string, relative: string): boolean {
    try {
        execFileSync("git", ["ls-files", "--error-unmatch", "--", relative], { cwd: root, stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function blocked(...lines: string[]): Verdict {
    return { exitCode: 2, message: lines.join("\n") };
}

export function guardEdit(input: string, project: EditHookProject, allowGateEdit: boolean): Verdict {
    const file = editedPath(input);
    const root = path.posix.normalize(project.root.replaceAll("\\", "/")).replace(/\/+$/, "");
    if (!file?.startsWith(`${root}/`)) return allowed;
    const relative = file.slice(root.length + 1);
    const lists = listsOf(project);
    if (matches(relative, lists.migrations) && existsSync(file)) {
        return blocked(
            `Blocked: ${relative} is a migration that already exists; the migrator refuses to start when a script changes after it ran.`,
            "Add a new script with the next free number instead (NNNN_what_it_does.sql).",
        );
    }
    const generated = Object.entries(lists.generated).find(([glob]) => path.posix.matchesGlob(relative, glob));
    if (generated !== undefined) return blocked(`Blocked: ${relative} is ${generated[1]}.`);
    if (allowGateEdit) return allowed;
    if (matches(relative, lists.gate)) {
        return blocked(
            `Blocked: ${relative} is part of the gate (suwgate.yml, a hook, a lint, type or build config), which an agent does not change on its own.`,
            ASK_THE_OWNER,
        );
    }
    if (matches(relative, lists.recordings) && isTracked(root, relative)) {
        return blocked(
            `Blocked: ${relative} records behaviour as it is today (a characterization test); an agent changes the code until the recording passes again, not the recording.`,
            ASK_THE_OWNER,
        );
    }
    return allowed;
}
