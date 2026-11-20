import { PROFILES, type Guard, type Profile } from "../../gate/contract.ts";

const EVERY_REPOSITORY = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    ".claude/settings.json",
    ".githooks/pre-commit",
    "justfile",
    "docs/architecture.md",
    "docs/development.md",
];

export const REQUIRED_BY_PROFILE: Readonly<Record<Profile, readonly string[]>> = {
    web: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "eslint.config.js", ".prettierrc.json", "knip.json"],
    library: ["LICENSE", "package.json", "pnpm-lock.yaml", ".changeset/config.json"],
    dotnet: [
        "global.json",
        "nuget.config",
        "Directory.Build.props",
        "Directory.Packages.props",
        "BannedSymbols.txt",
        ".config/dotnet-tools.json",
    ],
    database: ["compose.yaml"],
};

interface Settings {
    files?: string[];
}

function required(profiles: readonly Profile[], directories: Readonly<Partial<Record<Profile, string>>>, settings: Settings): string[] {
    const inProfiles = PROFILES.filter((profile) => profiles.includes(profile)).flatMap((profile) =>
        REQUIRED_BY_PROFILE[profile].map((file) => {
            const directory = directories[profile];
            return directory === undefined ? file : `${directory}/${file}`;
        }),
    );
    return [...new Set([...EVERY_REPOSITORY, ...inProfiles, ...(settings.files ?? [])])];
}

export const requiredFiles: Guard = {
    id: "required-files",
    description:
        "Every file a repository of these profiles needs is there (the agent rules, the editor and git settings, the hooks, each profile's tool configs)",
    profiles: "every",
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { files: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } } },
    },
    check(context) {
        const present = new Set(context.files);
        const settings = (context.settings ?? {}) as Settings;
        return required(context.profiles, context.directories, settings)
            .filter((file) => !present.has(file))
            .map((file) => ({
                target: file,
                message: `missing: add ${file} (its profile needs it), or add an exception with the reason it does not apply`,
            }));
    },
};
