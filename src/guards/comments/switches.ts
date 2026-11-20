import type { Finding, Guard } from "../../gate/contract.ts";
import { isScanned } from "./scan.ts";

interface Switch {
    files: RegExp;
    directive: RegExp;
    fix: string;
}

const SWITCHES: readonly Switch[] = [
    {
        files: /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/,
        directive: /(?:\/\/+|\/\*+)\s*(@ts-ignore|@ts-nocheck|eslint-disable[\w-]*|eslint(?=\s))/,
        fix: "fix the type or the code; a rule that does not fit this repository is switched off once, for every file, in eslint.config.js or tsconfig.json",
    },
    {
        files: /\.cs$/,
        directive: /^\s*#\s*pragma\s+warning\s+disable\b/,
        fix: "fix the code; a rule that does not fit is switched off in .editorconfig, or [SuppressMessage(..., Justification = ...)] goes on the member",
    },
];

export function switchesIn(file: string, text: string): Finding[] {
    const kind = SWITCHES.find((candidate) => candidate.files.test(file));
    if (kind === undefined) return [];
    return text.split("\n").flatMap((line, index) => {
        const match = kind.directive.exec(line);
        return match === null
            ? []
            : [{ target: file, line: index + 1, message: `${match[0].trim()} switches a check off in place: ${kind.fix}` }];
    });
}

export const noInPlaceSwitches: Guard = {
    id: "no-in-place-switches",
    description:
        "No source file switches the type checker, a lint rule or an analyzer off in place (@ts-ignore, @ts-nocheck, eslint-disable, an eslint config comment, #pragma warning disable)",
    profiles: ["web", "library", "dotnet"],
    check: (context) => context.files.filter(isScanned).flatMap((file) => switchesIn(file, context.read(file))),
};
