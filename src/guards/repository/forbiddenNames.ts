import { PROFILES, type Guard, type Profile } from "../../gate/contract.ts";
import { matchesAny, stringList } from "./text.ts";

const EVERY_REPOSITORY = [
    "common",
    "core",
    "helper",
    "helpers",
    "lib",
    "manager",
    "misc",
    "shared",
    "stuff",
    "util",
    "utilities",
    "utility",
    "utils",
];

export const FORBIDDEN_BY_PROFILE: Readonly<Record<Profile, readonly string[]>> = {
    web: ["components", "hooks", "ui"],
    library: ["components", "hooks", "ui"],
    dotnet: ["application", "controllers", "domain", "dtos", "infrastructure", "interfaces", "models", "repositories", "services"],
    database: [],
};

const FOLDERS_ONLY = ["base"];

const NOT_READ = ["docs/visual/**"];

interface Settings {
    words?: string[];
    ignore?: string[];
}

function words(name: string): string[] {
    return name
        .split(/[-_.\s]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
        .filter((word) => word.length > 0)
        .map((word) => word.toLowerCase());
}

export function forbiddenIn(name: string, forbidden: readonly string[]): string | undefined {
    const parts = words(name);
    return forbidden.find((word) => word === name.toLowerCase() || parts.includes(word));
}

function namedPaths(files: readonly string[]): { named: string; isFolderOrProject: boolean }[] {
    const named = new Map<string, boolean>();
    for (const file of files) {
        const parts = file.split("/");
        parts.slice(0, -1).forEach((_, index) => named.set(parts.slice(0, index + 1).join("/"), true));
        if (!named.has(file)) named.set(file, /\.\w+proj$/.test(file));
    }
    return [...named].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, isFolderOrProject]) => ({ named: path, isFolderOrProject }));
}

export const forbiddenNames: Guard = {
    id: "forbidden-names",
    description:
        "No folder, project or file is named by a vague word (utils, helpers, common), and no folder or project by the kind of thing it holds (services, components), instead of what it is",
    profiles: "every",
    settingsSchema: { type: "object", additionalProperties: false, properties: { words: stringList, ignore: stringList } },
    check(context) {
        const settings = (context.settings ?? {}) as Settings;
        const vague = [...EVERY_REPOSITORY, ...(settings.words ?? []).map((word) => word.toLowerCase())];
        const byKind = [
            ...FOLDERS_ONLY,
            ...PROFILES.filter((profile) => context.profiles.includes(profile)).flatMap((profile) => FORBIDDEN_BY_PROFILE[profile]),
        ];
        const ignored = [...NOT_READ, ...(settings.ignore ?? [])];
        return namedPaths(context.files.filter((file) => !matchesAny(file, ignored))).flatMap(({ named, isFolderOrProject }) => {
            const name = named.split("/").at(-1) ?? named;
            const word = forbiddenIn(name, isFolderOrProject ? [...vague, ...byKind] : vague);
            return word === undefined
                ? []
                : [
                      {
                          target: named,
                          message: `"${word}" names who uses it or what kind of thing it holds, not what it is: rename it after the feature or after what it is (Database, Output, appShell); one feature, one folder`,
                      },
                  ];
        });
    },
};
