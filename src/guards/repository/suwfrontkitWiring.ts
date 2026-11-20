import path from "node:path";

import type { Finding, Guard, GuardContext, Profile } from "../../gate/contract.ts";
import { npmDependencies } from "./packageManifests.ts";

const KIT = "@maniumek/suwfrontkit";
const THEME = `${KIT}/theme.css`;
const PROFILES: readonly Profile[] = ["web", "library"];
const MAIN_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']\/?([^"']+)["']/;
const CSS_IMPORT = /\bimport\s+["'](\.{1,2}\/[^"']+\.css)["']/g;

function importsTheme(text: string): boolean {
    const escaped = THEME.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(?:\\bimport\\s+|@import\\s+(?:url\\()?)["']${escaped}["']`).test(text);
}

function present(context: GuardContext, file: string): boolean {
    return context.files.includes(file);
}

function findingsIn(context: GuardContext, directory: string): Finding[] {
    const joined = (file: string) => (directory === "" ? file : path.posix.join(directory, file));
    const html = joined("index.html");
    if (!present(context, html)) return [];
    const main = MAIN_SCRIPT.exec(context.read(html))?.[1];
    if (main === undefined) return [];
    const module = joined(main);
    if (!present(context, module)) return [];
    const text = context.read(module);
    const stylesheets = [...text.matchAll(CSS_IMPORT)].map((match) => path.posix.join(path.posix.dirname(module), match[1] ?? ""));
    if (importsTheme(text) || stylesheets.some((sheet) => present(context, sheet) && importsTheme(context.read(sheet)))) return [];
    return [
        {
            target: module,
            message: `the app depends on ${KIT} but neither its main module nor a stylesheet it imports loads the kit's theme: add @import "${THEME}"; at the top of the entry stylesheet (or import "${THEME}" in ${path.posix.basename(module)}), so the kit's components get their tokens`,
        },
    ];
}

export const suwfrontkitWiring: Guard = {
    id: "suwfrontkit-wiring",
    description: `A web app (an index.html with a module script) that depends on ${KIT} loads ${THEME} from its main module or a stylesheet that module imports`,
    profiles: PROFILES,
    check(context) {
        const directories = [
            ...new Set(
                PROFILES.filter((profile) => context.profiles.includes(profile)).map((profile) => context.directories[profile] ?? ""),
            ),
        ];
        const manifests = new Set(
            npmDependencies(context)
                .filter((dependency) => dependency.name === KIT)
                .map((dependency) => dependency.manifest),
        );
        return directories
            .filter((directory) => manifests.has(directory === "" ? "package.json" : `${directory}/package.json`))
            .flatMap((directory) => findingsIn(context, directory));
    },
};
