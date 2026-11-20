import type { Finding, Guard } from "../../gate/contract.ts";
import { dotnetFiles } from "./msbuild.ts";

const FRAMEWORK_SECTIONS = ["Logging", "AllowedHosts", "ConnectionStrings", "Kestrel"];

const APPSETTINGS = /(^|\/)appsettings(\.[\w-]+)?\.json$/;
const CSHARP = /\.cs$/;
const SECTION_READ = /\b(?:BindConfiguration|GetSection|GetRequiredSection)\(\s*"([^":]+)/g;

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
    description: "Every section of appsettings*.json is read by the code (an options class bound to it), so no setting is dead",
    profiles: ["dotnet"],
    check(context) {
        const read = new Set(
            dotnetFiles(context, CSHARP).flatMap((file) => [...context.read(file).matchAll(SECTION_READ)].map((match) => match[1] ?? "")),
        );
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
