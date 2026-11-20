import path from "node:path";

import js from "@eslint/js";
import type { ESLint, Linter } from "eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

import { noComments } from "./noComments.ts";

export { noComments };

export interface StrictOptions {
    root: string;
    projects?: readonly string[];
    ignores?: readonly string[];
    untyped?: readonly string[];
}

export interface AppOptions extends StrictOptions {
    features: readonly string[];
    shared?: readonly string[];
    sharedImports?: readonly (readonly [from: string, to: string])[];
    storage?: readonly string[];
}

const BOUNDARIES_PLUGIN = boundaries as unknown as ESLint.Plugin;
const CODE = ["**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"];
const SOURCES = ["src/**/*.{ts,tsx}"];
const BROWSER_STORAGE = ["localStorage", "sessionStorage", "indexedDB"];
const BROWSER_STORAGE_FIX =
    "Keep the state on the server, in the address or in React; browser storage is allowed only in the files that storage of app() names in eslint.config.js.";
const BOUNDARIES_FIX =
    "A feature of src/ imports only itself and the shared folders, a shared folder only itself (and the shared folders sharedImports of app() lets it), a file directly in src/ anything; a new folder of src/ goes into features or shared of app() in eslint.config.js.";

export const plugin: ESLint.Plugin = {
    meta: { name: "@maniumek/suwgate" },
    rules: { "no-comments": noComments },
};

export function strict(options: StrictOptions): Linter.Config[] {
    return defineConfig(
        globalIgnores(["dist", ".artifacts", ...(options.ignores ?? [])]),
        js.configs.recommended,
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
        {
            linterOptions: { noInlineConfig: true },
            languageOptions: {
                parserOptions: { project: [...(options.projects ?? ["./tsconfig.json"])], tsconfigRootDir: options.root },
            },
            rules: {
                "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
                "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
                "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
            },
        },
        {
            files: CODE,
            plugins: { suwgate: plugin },
            rules: { "suwgate/no-comments": "error" },
        },
        {
            files: ["eslint.config.js", ...(options.untyped ?? [])],
            extends: [tseslint.configs.disableTypeChecked],
        },
    );
}

function featureBoundaries(options: AppOptions): Linter.Config {
    const shared = options.shared ?? [];
    return {
        files: SOURCES,
        plugins: { boundaries: BOUNDARIES_PLUGIN },
        settings: {
            "boundaries/root-path": options.root,
            "import/resolver": {
                typescript: { project: (options.projects ?? ["./tsconfig.json"]).map((project) => path.resolve(options.root, project)) },
                node: { extensions: [".ts", ".tsx"] },
            },
            "boundaries/elements": [
                ...shared.map((name) => ({ type: "shared", pattern: `src/${name}` })),
                ...options.features.map((name) => ({ type: "feature", pattern: `src/${name}` })),
            ],
            "boundaries/files": [{ category: "entry", pattern: "src/*.{ts,tsx}" }],
        },
        rules: {
            "boundaries/no-unknown-files": ["error"],
            "boundaries/dependencies": [
                "error",
                {
                    default: "disallow",
                    message: BOUNDARIES_FIX,
                    policies: [
                        { allow: { to: { module: { origin: "external" } } } },
                        { allow: { dependency: { relationship: { to: "internal" } } } },
                        {
                            from: { file: { categories: "entry" } },
                            allow: { to: [{ file: { categories: "entry" } }, { element: { types: { anyOf: ["feature", "shared"] } } }] },
                        },
                        { from: { element: { type: "feature" } }, allow: { to: { element: { type: "shared" } } } },
                        ...(options.sharedImports ?? []).map(([from, to]) => ({
                            from: { element: { type: "shared", path: `src/${from}/**` } },
                            allow: { to: { element: { type: "shared", path: `src/${to}/**` } } },
                        })),
                    ],
                },
            ],
        },
    };
}

function browserStorageBan(options: AppOptions): Linter.Config {
    return {
        files: SOURCES,
        ignores: [...(options.storage ?? [])],
        rules: {
            "no-restricted-globals": ["error", ...BROWSER_STORAGE.map((name) => ({ name, message: BROWSER_STORAGE_FIX }))],
            "no-restricted-properties": [
                "error",
                ...["window", "globalThis"].flatMap((object) =>
                    BROWSER_STORAGE.map((property) => ({ object, property, message: BROWSER_STORAGE_FIX })),
                ),
            ],
        },
    };
}

export function app(options: AppOptions): Linter.Config[] {
    return [...strict(options), featureBoundaries(options), browserStorageBan(options)];
}
