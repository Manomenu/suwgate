import type { Finding, Guard } from "../../gate/contract.ts";
import { dotnetFiles } from "./msbuild.ts";

const FRAMEWORK_SECTIONS = ["Logging", "AllowedHosts", "ConnectionStrings", "Kestrel"];

const APPSETTINGS = /(^|\/)appsettings(\.[\w-]+)?\.json$/;
const CSHARP = /\.cs$/;
const SECTION_READ = /\b(?:BindConfiguration|GetSection|GetRequiredSection)\(\s*"([^":]+)/g;
const SECTION_READ_BY_NAME = /\b(?:BindConfiguration|GetSection|GetRequiredSection)\(\s*([A-Za-z_][\w.]*)\s*\)/g;
const TYPE_OR_CONSTANT = /\b(?:class|record|struct|interface)\s+(\w+)|\bconst\s+string\s+(\w+)\s*=\s*"([^":]+)"/g;

function constants(text: string): Map<string, string> {
    const found = new Map<string, string>();
    let type = "";
    for (const match of text.matchAll(TYPE_OR_CONSTANT)) {
        if (match[1] !== undefined) {
            type = match[1];
        } else if (match[2] !== undefined && match[3] !== undefined) {
            found.set(match[2], match[3]);
            if (type !== "") found.set(`${type}.${match[2]}`, match[3]);
        }
    }
    return found;
}

function sectionsRead(texts: readonly string[]): Set<string> {
    const named = new Map(texts.flatMap((text) => [...constants(text)]));
    return new Set(
        texts.flatMap((text) => [
            ...[...text.matchAll(SECTION_READ)].map((match) => match[1] ?? ""),
            ...[...text.matchAll(SECTION_READ_BY_NAME)].flatMap((match) => {
                const name = match[1] ?? "";
                return named.get(name) ?? named.get(name.split(".").slice(-2).join(".")) ?? [];
            }),
        ]),
    );
}

function sectionsOf(file: string, text: string): { sections: string[]; problem?: Finding } {
    try {
        const parsed: unknown = JSON.parse(text);
        return { sections: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? Object.keys(parsed) : [] };
    } catch (error) {
        return {
            sections: [],
            problem: { target: file, message: `not valid JSON (${error instanceof Error ? error.message : String(error)}): fix the file` },
        };
    }
}

export const appsettingsBound: Guard = {
    id: "appsettings-bound",
    description:
        "Every section of appsettings*.json is read by the code (an options class bound to it, by a string or a const string), so no setting is dead",
    profiles: ["dotnet"],
    check(context) {
        const read = sectionsRead(dotnetFiles(context, CSHARP).map((file) => context.read(file)));
        const problems: Finding[] = [];
        const unread = new Map<string, string[]>();
        for (const file of dotnetFiles(context, APPSETTINGS)) {
            const { sections, problem } = sectionsOf(file, context.read(file));
            if (problem !== undefined) {
                problems.push(problem);
            }
            for (const section of sections.filter((name) => !FRAMEWORK_SECTIONS.includes(name) && !read.has(name))) {
                unread.set(section, [...(unread.get(section) ?? []), file]);
            }
        }
        const unbound = [...unread.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([section, files]) => ({
                target: section,
                message: `no code reads it (in ${files.join(", ")}): remove the setting, or bind it with services.AddOptions<T>().BindConfiguration("${section}")`,
            }));
        return [...problems, ...unbound];
    },
};
