import type { GuardContext } from "../../gate/contract.ts";
import { baseName, isRecord, lineAt, parseJson } from "./text.ts";

export const RUNTIME_GROUPS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
const ALL_GROUPS = [...RUNTIME_GROUPS, "devDependencies"] as const;

export interface Dependency {
    manifest: string;
    name: string;
    version: string;
    group: (typeof ALL_GROUPS)[number];
    line: number;
    privateManifest: boolean;
}

export function npmDependencies(context: GuardContext): Dependency[] {
    return context.files
        .filter((file) => baseName(file) === "package.json")
        .flatMap((manifest) => {
            const text = context.read(manifest);
            const parsed = parseJson(text);
            if (!isRecord(parsed)) return [];
            return ALL_GROUPS.flatMap((group) => {
                const dependencies = parsed[group];
                if (!isRecord(dependencies)) return [];
                return Object.entries(dependencies).map(([name, version]) => ({
                    manifest,
                    name,
                    version: typeof version === "string" ? version : "",
                    group,
                    line: lineAt(text, Math.max(0, text.indexOf(`"${name}"`))),
                    privateManifest: parsed["private"] === true,
                }));
            });
        });
}
