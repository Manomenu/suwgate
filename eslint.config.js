import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

const TOOL_DIRECTIVES = [/^ @ts-expect-error \S/, /^ @vitest-environment [\w-]+$/];
const CRITERION_MARKER = /^ AC-[a-z0-9]+(-[a-z0-9]+)*-[0-9]+$/;

export const noComments = {
    meta: {
        type: "problem",
        schema: [],
        messages: {
            comment:
                'Delete the comment; rename or split the code so it explains itself; put lasting knowledge in a test, the README, docs/ or AGENTS.md (the only comments allowed are the tool directives listed in AGENTS.md, "No comments").',
        },
    },
    create(context) {
        const readsCriterionMarkers = context.filename.endsWith("eslint.config.js");
        return {
            Program() {
                for (const comment of context.sourceCode.getAllComments()) {
                    const allowed =
                        comment.type === "Shebang" ||
                        TOOL_DIRECTIVES.some((directive) => directive.test(comment.value)) ||
                        (readsCriterionMarkers && CRITERION_MARKER.test(comment.value));
                    if (!allowed) {
                        context.report({ loc: comment.loc, messageId: "comment" });
                    }
                }
            },
        };
    },
};

export default defineConfig(
    { ignores: ["dist", ".artifacts", "dotnet"] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: { project: ["./tsconfig.json"], tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
            "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
        },
    },
    {
        files: ["src/**/*.ts"],
        ignores: ["src/**/*.test.ts"],
        plugins: { boundaries },
        settings: {
            "import/resolver": { typescript: { project: "./tsconfig.json" }, node: { extensions: [".ts"] } },
            "boundaries/elements": [
                { type: "gate", pattern: "src/gate" },
                { type: "profiles", pattern: "src/profiles" },
                { type: "session", pattern: "src/session" },
                { type: "dev", pattern: "src/dev" },
                { type: "guards", pattern: "src/guards/*", capture: ["package"] },
            ],
            "boundaries/files": [
                { category: "cli", pattern: "src/cli.ts" },
                { category: "registry", pattern: "src/guards/index.ts" },
                { category: "contract", pattern: "src/gate/contract.ts" },
            ],
        },
        rules: {
            "boundaries/dependencies": [
                "error",
                {
                    default: "disallow",
                    message:
                        "{{from.element.type}} must not import {{to.element.type}}: a guard package and the profiles use only src/gate/contract.ts, the gate takes the guards and steps it is given, only src/cli.ts wires them together (docs/architecture.md)",
                    policies: [
                        { allow: { to: { module: { origin: "external" } } } },
                        { allow: { dependency: { relationship: { to: "internal" } } } },
                        {
                            from: { file: { categories: "cli" } },
                            allow: {
                                to: [
                                    { element: { types: { anyOf: ["gate", "profiles", "session", "dev"] } } },
                                    { file: { categories: "registry" } },
                                ],
                            },
                        },
                        {
                            from: { file: { categories: "registry" } },
                            allow: { to: [{ element: { type: "guards" } }, { file: { categories: "contract" } }] },
                        },
                        {
                            from: { element: { types: { anyOf: ["guards", "profiles"] } } },
                            allow: { to: { file: { categories: "contract" } } },
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["**/*.{ts,js,mjs,cjs}"],
        plugins: { local: { rules: { "no-comments": noComments } } },
        rules: { "local/no-comments": "error" },
    },
    {
        files: ["eslint.config.js", "eslint.config.test.js"],
        extends: [tseslint.configs.disableTypeChecked],
    },
);
