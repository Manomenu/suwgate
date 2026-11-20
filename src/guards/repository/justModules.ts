import type { Finding, Guard } from "../../gate/contract.ts";
import { baseName } from "./text.ts";

const MOD_LINE = /^mod\??\s+([\w-]+)(?:\s+(['"])([^'"]+)\2)?\s*$/gm;

const SOURCES_IN_A_FOLDER = ["mod.just", "justfile", ".justfile"];

interface Mod {
    name: string;
    path?: string;
}

export function moduleName(file: string): string {
    return file.endsWith("/mod.just") ? (file.split("/")[0] ?? "") : baseName(file).replace(/\.just$/, "");
}

function normalized(file: string): string {
    return file.replace(/^\.\//, "").replace(/\/+$/, "");
}

function sourceOf(mod: Mod, files: readonly string[]): string | undefined {
    if (mod.path === undefined) return files.find((file) => file === `${mod.name}.just` || file === `${mod.name}/mod.just`);
    const path = normalized(mod.path);
    return files.includes(path) ? path : SOURCES_IN_A_FOLDER.map((name) => `${path}/${name}`).find((file) => files.includes(file));
}

export const justModules: Guard = {
    id: "just-modules",
    description:
        "Every just module is <name>.just beside the justfile, <folder>/mod.just, or the file a mod line names by its path (mod <name> '<path>'), and the justfile names each one",
    profiles: "every",
    check(context) {
        const modules = context.files.filter((file) => file.endsWith(".just"));
        const mods: Mod[] = context.files.includes("justfile")
            ? [...context.read("justfile").matchAll(MOD_LINE)].map((match) => ({
                  name: match[1] ?? "",
                  ...(match[3] === undefined ? {} : { path: match[3] }),
              }))
            : [];
        const byPath = mods.filter((mod) => mod.path !== undefined).flatMap((mod) => sourceOf(mod, context.files) ?? []);
        const named = mods.filter((mod) => mod.path === undefined).map((mod) => mod.name);
        const misplaced: Finding[] = modules
            .filter((file) => !byPath.includes(file))
            .filter((file) => file.includes("/") && (baseName(file) !== "mod.just" || file.split("/").length !== 2))
            .map((file) => ({
                target: file,
                message:
                    "just finds a module by its name only as <name>.just beside the justfile or as <folder>/mod.just: move it there, or name its path in the mod line (mod <name> '<path>')",
            }));
        const missing: Finding[] = mods
            .filter((mod) => sourceOf(mod, context.files) === undefined)
            .map((mod) => ({
                target: "justfile",
                message:
                    mod.path === undefined
                        ? `mod ${mod.name} has no ${mod.name}.just or ${mod.name}/mod.just: add the module, or delete the mod line`
                        : `mod ${mod.name} names ${mod.path}, which is not a module file here: fix the path, or delete the mod line`,
            }));
        const orphans: Finding[] = modules
            .filter((file) => !byPath.includes(file) && !named.includes(moduleName(file)))
            .filter((file) => !misplaced.some((finding) => finding.target === file))
            .map((file) => ({
                target: file,
                message: `the justfile does not load it: add mod ${moduleName(file)} to the justfile, or delete the module`,
            }));
        return [...misplaced, ...missing, ...orphans];
    },
};
