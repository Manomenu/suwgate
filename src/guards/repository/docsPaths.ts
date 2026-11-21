import path from "node:path";

import type { Finding, Guard } from "../../gate/contract.ts";
import { baseName, lineAt, matchesAny, stringList } from "./text.ts";

const MENTION = /`([\w.\-/@]+)`|\]\(([\w.\-/]+)(?:#[\w-]*)?\)/g;
const FILE_NAME = /[\w-]\.(cs|csproj|css|json|md|props|sh|slnx|sql|ts|tsx|txt|yaml|yml)$/;
const NOT_IN_THE_REPOSITORY = ["CLAUDE.local.md", "dist/"];
const NOT_READ = ["docs/visual/**", ".changeset/**", "AGENTS.shared.md"];
export const DOTNET_GUARD_IDS = [
    "architecture/build-settings",
    "architecture/endpoints",
    "architecture/every-project-guarded",
    "architecture/forbidden-type-names",
    "architecture/interfaces-have-two-implementations",
    "architecture/layers",
    "architecture/no-escape-hatches",
    "architecture/no-fixture-in-field",
    "architecture/no-unused-types",
    "architecture/nothing-obsolete",
    "architecture/one-type-per-file",
    "architecture/project-references",
    "architecture/unique-type-names",
    "database/migration-script-names",
];

interface Settings {
    ignore?: string[];
    skip?: string[];
}

export function isPath(mention: string): boolean {
    return !/^(https?:|\/|@|~)/.test(mention) && (mention.includes("/") || FILE_NAME.test(mention)) && !DOTNET_GUARD_IDS.includes(mention);
}

function existsLoosely(mention: string, files: readonly string[]): boolean {
    const name = mention.replace(/^(\.\.?\/)+/, "");
    const folder = `${name.replace(/\/+$/, "")}/`;
    return files.some((file) => file === name || file.startsWith(folder) || file.endsWith(`/${name}`) || file.includes(`/${folder}`));
}

function existsFrom(document: string, link: string, files: readonly string[]): boolean {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(document), link));
    if (resolved.startsWith("../")) return false;
    const folder = `${resolved.replace(/\/+$/, "")}/`;
    return files.some((file) => file === resolved || file.startsWith(folder)) || (!link.startsWith(".") && existsLoosely(link, files));
}

function isIgnored(mention: string, ignored: readonly string[]): boolean {
    return ignored.some((name) => mention === name || (name.endsWith("/") && mention.startsWith(name)));
}

function stale(document: string, text: string, files: readonly string[], ignored: readonly string[]): Finding[] {
    return [...text.matchAll(MENTION)].flatMap((match) => {
        const mention = match[1] ?? match[2] ?? "";
        const isLink = match[1] === undefined;
        if (!isPath(mention) || isIgnored(mention, ignored)) return [];
        if (isLink ? existsFrom(document, mention, files) : existsLoosely(mention, files)) return [];
        return [
            {
                target: document,
                line: lineAt(text, match.index),
                message: `${mention} is not a path in this repository: fix the path, or say what the code does instead of where it is (a name meant to be outside the repository, or a pattern of names, goes into settings.docs-paths.ignore, a folder there ends with /; a whole document that is not about this repository goes into settings.docs-paths.skip as a glob)`,
            },
        ];
    });
}

export const docsPaths: Guard = {
    id: "docs-paths",
    description:
        "Every file and folder the Markdown docs name, in backticks or as a link, exists in the repository (a .NET guard id is not a path)",
    profiles: "every",
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            ignore: { ...stringList, description: "Names the docs may mention that are not paths here; a folder ends with /." },
            skip: { ...stringList, description: "Globs of documents not read at all, such as docs/notes/**." },
        },
    },
    check(context) {
        const settings = (context.settings ?? {}) as Settings;
        const ignored = [...NOT_IN_THE_REPOSITORY, ...(settings.ignore ?? [])];
        const notRead = [...NOT_READ, ...(settings.skip ?? [])];
        return context.files
            .filter((file) => file.endsWith(".md") && baseName(file) !== "CHANGELOG.md" && !matchesAny(file, notRead))
            .flatMap((document) => stale(document, context.read(document), context.files, ignored));
    },
};
