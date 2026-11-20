import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Finding, Guard, GuardContext, Profile } from "../../gate/contract.ts";
import { isScanned } from "./scan.ts";

const RULE = "suwgate/no-comments";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
export const GENERATED_API_TYPES = "src/api/openapi.d.ts";
const LINTED_PROFILES: readonly Profile[] = ["web", "library"];
const USE_THE_PRESET = `extend strict() or app() of @maniumek/suwgate/eslint in eslint.config.js, or switch ${RULE} on as an error for every TypeScript and JavaScript file`;

interface Linter {
    isPathIgnored(file: string): Promise<boolean>;
    calculateConfigForFile(file: string): Promise<{ rules?: Record<string, unknown> } | undefined>;
}

interface EslintModule {
    ESLint: new (options: { cwd: string }) => Linter;
}

function lintedDirectories(context: GuardContext): string[] {
    return [
        ...new Set(
            LINTED_PROFILES.filter((profile) => context.profiles.includes(profile)).map((profile) => context.directories[profile] ?? "."),
        ),
    ];
}

function inDirectory(file: string, directory: string): boolean {
    return directory === "." || file.startsWith(`${directory}/`);
}

function isError(setting: unknown): boolean {
    const severity = Array.isArray(setting) ? (setting[0] as unknown) : setting;
    return severity === 2 || severity === "error";
}

async function loadEslint(cwd: string): Promise<EslintModule | null> {
    if (!existsSync(path.join(cwd, "package.json"))) return null;
    try {
        const resolved = createRequire(path.join(cwd, "package.json")).resolve("eslint");
        return (await import(pathToFileURL(resolved).href)) as EslintModule;
    } catch {
        return null;
    }
}

type Verdict = "refused" | "ignored" | "allowed";

const IGNORED =
    "eslint ignores this file, so a comment in it goes unnoticed: take it out of the ignores of eslint.config.js (a file outside the tsconfig projects goes into untyped of strict() instead), or add an exception if it is generated";

async function verdictOf(eslint: Linter, absolute: string): Promise<Verdict> {
    if (await eslint.isPathIgnored(absolute)) return "ignored";
    const config = await eslint.calculateConfigForFile(absolute);
    return isError(config?.rules?.[RULE]) ? "refused" : "allowed";
}

function findingOf(file: string, verdict: Verdict): Finding[] {
    if (verdict === "ignored") return [{ target: file, message: IGNORED }];
    if (verdict === "allowed") return [{ target: file, message: `eslint does not refuse comments in this file: ${USE_THE_PRESET}` }];
    return [];
}

async function findingsIn(context: GuardContext, directory: string): Promise<Finding[]> {
    const generated = context.profiles.includes("web") ? path.posix.join(context.directories.web ?? ".", GENERATED_API_TYPES) : null;
    const files = context.files.filter((file) => CODE.test(file) && isScanned(file) && inDirectory(file, directory) && file !== generated);
    if (files.length === 0) return [];
    const cwd = path.join(context.root, directory);
    const eslint = await loadEslint(cwd);
    if (eslint === null) {
        return [
            {
                target: directory,
                message: `eslint cannot be loaded from ${directory}: install the packages (pnpm install) and add eslint to its devDependencies`,
            },
        ];
    }
    const linter = new eslint.ESLint({ cwd });
    const verdicts = await Promise.all(files.map((file) => verdictOf(linter, path.join(context.root, file))));
    if (!verdicts.includes("refused")) {
        return [{ target: directory, message: `eslint refuses comments in no TypeScript or JavaScript file here: ${USE_THE_PRESET}` }];
    }
    return files.flatMap((file, index) => findingOf(file, verdicts[index] ?? "allowed"));
}

export const commentsEslint: Guard = {
    id: "comments-eslint",
    description: `ESLint lints every TypeScript and JavaScript file but the web app's generated API types and refuses its comments with ${RULE} as an error`,
    profiles: LINTED_PROFILES,
    check: async (context) => (await Promise.all(lintedDirectories(context).map((directory) => findingsIn(context, directory)))).flat(),
};
