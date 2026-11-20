import { defineConfig } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";

import { strict } from "./src/eslint/index.ts";

export default defineConfig(strict({ root: import.meta.dirname, ignores: ["dotnet"] }), {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    plugins: { boundaries },
    settings: {
        "import/resolver": { typescript: { project: "./tsconfig.json" }, node: { extensions: [".ts"] } },
        "boundaries/elements": [
            { type: "gate", pattern: "src/gate" },
            { type: "profiles", pattern: "src/profiles" },
            { type: "session", pattern: "src/session" },
            { type: "eslint", pattern: "src/eslint" },
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
});
