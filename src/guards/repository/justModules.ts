import type { Finding, Guard } from "../../gate/contract.ts";
import { baseName } from "./text.ts";

const MOD_LINE = /^mod\??\s+([\w-]+)\s*$/gm;

function moduleName(file: string): string {
    return file.endsWith("/mod.just") ? (file.split("/")[0] ?? "") : baseName(file).replace(/\.just$/, "");
}

export const justModules: Guard = {
    id: "just-modules",
    description:
        "Every just module is <name>.just beside the justfile or <folder>/mod.just, and the justfile names each one with mod <name>",
    profiles: "every",
    check(context) {
        const modules = context.files.filter((file) => file.endsWith(".just"));
        const named = context.files.includes("justfile")
            ? [...context.read("justfile").matchAll(MOD_LINE)].map((match) => match[1] ?? "")
            : [];
        const misplaced: Finding[] = modules
            .filter((file) => file.includes("/") && (baseName(file) !== "mod.just" || file.split("/").length !== 2))
            .map((file) => ({
                target: file,
                message: "just finds a module only as <name>.just beside the justfile or as <folder>/mod.just: move it there",
            }));
        const missing: Finding[] = named
            .filter((name) => !modules.includes(`${name}.just`) && !modules.includes(`${name}/mod.just`))
            .map((name) => ({
                target: "justfile",
                message: `mod ${name} has no ${name}.just or ${name}/mod.just: add the module, or delete the mod line`,
            }));
        const orphans: Finding[] = modules
            .filter((file) => !named.includes(moduleName(file)))
            .filter((file) => !misplaced.some((finding) => finding.target === file))
            .map((file) => ({
                target: file,
                message: `the justfile does not load it: add mod ${moduleName(file)} to the justfile, or delete the module`,
            }));
        return [...misplaced, ...missing, ...orphans];
    },
};
