import type { Profile, Step, StepContext } from "../gate/contract.ts";
import { changedIn, filesIn, has, read, withChanged } from "./shell.ts";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const TSCONFIG = /^tsconfig(\..+)?\.json$/;

const VITEST_CONFIG = /^vitest\.config\.(ts|mts|js|mjs)$/;

const UNIT_PROJECT = /\bname:\s*["'`]unit["'`]/;

export const PNPM_INSTALL = "pnpm-install";

function install(context: StepContext): string | null {
    return has(context, "node_modules") ? null : "pnpm install --frozen-lockfile --silent";
}

export function typecheck(context: StepContext): string {
    const configs = filesIn(context, TSCONFIG).filter((file) => file !== "tsconfig.build.json");
    const ordered = [...configs.filter((file) => file === "tsconfig.json"), ...configs.filter((file) => file !== "tsconfig.json")];
    return (ordered.length === 0 ? ["tsconfig.json"] : ordered).map((file) => `pnpm exec tsc --noEmit -p ${file}`).join(" && ");
}

export function unitTests(context: StepContext): string {
    const named = filesIn(context, VITEST_CONFIG).some((file) => UNIT_PROJECT.test(read(context, file) ?? ""));
    return named ? "pnpm exec vitest run --project unit" : "pnpm exec vitest run";
}

export function nodeSteps(profile: Profile): Step[] {
    const after = [PNPM_INSTALL];
    return [
        {
            id: PNPM_INSTALL,
            title: "packages from the lockfile when node_modules is missing (pnpm install --frozen-lockfile)",
            profile,
            needs: ["pnpm"],
            run: install,
            quick: install,
            limitSeconds: 300,
        },
        {
            id: "typecheck",
            title: "typecheck (tsc, every tsconfig*.json but the build one)",
            profile,
            needs: ["pnpm"],
            after,
            run: typecheck,
            quick: (context) => (changedIn(context, CODE).length === 0 ? null : typecheck(context)),
            limitSeconds: 180,
        },
        {
            id: "lint",
            title: "lint (eslint)",
            profile,
            needs: ["pnpm"],
            after,
            run: "pnpm exec eslint . --max-warnings 0",
            quick: (context) => withChanged(context, CODE, "pnpm exec eslint --no-warn-ignored --max-warnings 0"),
            limitSeconds: 300,
        },
        {
            id: "unit-tests",
            title: "unit tests (vitest, the project unit when the config has several)",
            profile,
            needs: ["pnpm"],
            after,
            run: unitTests,
            limitSeconds: 300,
        },
        {
            id: "format",
            title: "format (prettier --check)",
            profile,
            needs: ["pnpm"],
            after,
            run: "pnpm exec prettier --check --log-level warn .",
            limitSeconds: 180,
        },
        {
            id: "knip",
            title: "dead code and unused dependencies (knip)",
            profile,
            needs: ["pnpm"],
            after,
            run: "pnpm exec knip",
            limitSeconds: 180,
        },
    ];
}
