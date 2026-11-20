import { PROFILES, type Guard, type Profile } from "../../gate/contract.ts";
import { inProfileDirectory, stringList } from "./text.ts";

type Purposes = Readonly<Record<string, string>>;

export const EVERY_REPOSITORY: Purposes = {
    "suwgate.yml": "the repository's gate: its profiles, the steps it adds or skips, and the exceptions with their reasons",
    "README.md": "what the project is and how to use it, for people",
    "AGENTS.md": "the rules every agent and person reads before changing the repository",
    "CLAUDE.md": "it points Claude Code to the rules with exactly @AGENTS.md",
    ".editorconfig": "the whitespace and line endings every editor follows",
    ".gitattributes": "the line endings and binary files git keeps the same on every machine",
    ".gitignore": "it keeps build output, secrets and local settings out of git, and so out of every guard's file list",
    ".claude/settings.json": "it wires the Claude Code hooks suwgate hook stop and suwgate hook guard-edit",
    ".githooks/pre-commit": "the git hook that runs suwgate hook pre-commit (gitleaks on the staged changes, then the quick gate)",
    justfile: "the recipes people run, which just lists",
    "docs/architecture.md": "the map of the top-level folders, which repository-layout reads, and the contracts of the code",
    "docs/development.md": "how to set up the repository and work on it",
    ".vscode/settings.json": "the editor's glue: the formatter per language and yaml.schemas for suwgate.yml",
    ".vscode/extensions.json": "the editor extensions the repository expects",
};

export const REQUIRED_BY_PROFILE: Readonly<Record<Profile, Purposes>> = {
    web: {
        "package.json": "the web app's packages and scripts",
        "pnpm-lock.yaml": "the exact versions pnpm installs, the same on every machine and in CI",
        "pnpm-workspace.yaml": "pnpm's settings, such as the minimum age of a new release",
        "tsconfig.json": "the strict TypeScript options the typecheck step uses",
        "eslint.config.js": "the lint rules, including no comments and the feature boundaries",
        ".prettierrc.json": "the formatting the format step checks",
        "knip.config.ts": "knip's config, one line that extends @maniumek/suwgate/knip, so dead code is found",
    },
    library: {
        LICENSE: "the terms under which the published package may be used",
        "package.json": "the published package: its name, entry points and dependencies",
        "pnpm-lock.yaml": "the exact versions pnpm installs, the same on every machine and in CI",
        ".changeset/config.json": "the changesets that describe each change of the package for its next release",
    },
    dotnet: {
        "global.json": "the .NET SDK every machine and CI builds with",
        "nuget.config": "the package sources, so a restore never reaches an unexpected feed",
        "Directory.Build.props": "the build settings of every project (warnings as errors, analyzers, nullable, lock files)",
        "Directory.Packages.props": "the one place that pins the version of every NuGet package",
        ".config/dotnet-tools.json": "the .NET tools at pinned versions, such as CSharpier for the format step",
        "layers.json": "the layers of the server and which project may reference which, read by Suwgate.Architecture",
    },
    database: {
        "compose.yaml": "the local PostgreSQL the server and its tests run against",
    },
};

interface Settings {
    files?: string[];
}

function required(context: Parameters<Guard["check"]>[0], settings: Settings): Map<string, string> {
    const files = new Map<string, string>();
    for (const [file, purpose] of Object.entries(EVERY_REPOSITORY)) files.set(file, `${purpose}. Every repository needs it: add it`);
    for (const profile of PROFILES.filter((candidate) => context.profiles.includes(candidate))) {
        for (const [file, purpose] of Object.entries(REQUIRED_BY_PROFILE[profile])) {
            const placed = inProfileDirectory(context.directories, profile, file);
            if (!files.has(placed)) files.set(placed, `${purpose}. The ${profile} profile needs it: add it`);
        }
    }
    for (const file of settings.files ?? []) {
        if (!files.has(file)) files.set(file, "settings.required-files.files in suwgate.yml asks for it: add it");
    }
    return files;
}

export const requiredFiles: Guard = {
    id: "required-files",
    description:
        "Every file a repository of these profiles needs is there (the gate, the agent rules, the editor and git settings, the hooks, each profile's tool configs)",
    profiles: "every",
    settingsSchema: { type: "object", additionalProperties: false, properties: { files: stringList } },
    check(context) {
        const present = new Set(context.files);
        return [...required(context, (context.settings ?? {}) as Settings)]
            .filter(([file]) => !present.has(file))
            .map(([file, purpose]) => ({
                target: file,
                message: `missing: ${purpose}, or add an exception with the reason it does not apply`,
            }));
    },
};
