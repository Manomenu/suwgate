import type { Profile, Step, StepContext } from "../gate/contract.ts";
import { changedIn, countedVitest, filesIn, has, quoted, read, tracked, verdictCommand, withChanged } from "./shell.ts";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const TSCONFIG = /^tsconfig(\..+)?\.json$/;

const VITEST_CONFIG = /^vitest\.config\.(ts|mts|js|mjs)$/;

const UNIT_PROJECT = /\bname:\s*["'`]unit["'`]|\bunitTests\(/;

const NOT_A_SOURCE = /\.(test|stories|e2e|visual|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;

const ENFORCED_RULES = ["suwgate/no-comments", "boundaries/dependencies"];

export const PNPM_INSTALL = "pnpm-install";

function install(context: StepContext): string | null {
    return has(context, "node_modules") ? null : "pnpm install --frozen-lockfile --silent";
}

export function typecheck(context: StepContext): string {
    const configs = filesIn(context, TSCONFIG).filter((file) => file !== "tsconfig.build.json");
    const ordered = [...configs.filter((file) => file === "tsconfig.json"), ...configs.filter((file) => file !== "tsconfig.json")];
    return (ordered.length === 0 ? ["tsconfig.json"] : ordered)
        .map(
            (file) =>
                `pnpm exec tsc --noEmit -p ${file} && pnpm exec tsc --showConfig -p ${file} | ${verdictCommand(`tsconfig ${quoted(file)}`)}`,
        )
        .join(" && ");
}

function lint(context: StepContext): string {
    const source = tracked(context, ["src/*.ts", "src/*.tsx"]).find((file) => !NOT_A_SOURCE.test(file));
    const rules =
        source === undefined
            ? []
            : [
                  `pnpm exec eslint --print-config ${quoted(source)} | ${verdictCommand(`eslint ${quoted(source)} ${ENFORCED_RULES.join(" ")}`)}`,
              ];
    return [...rules, "pnpm exec eslint . --max-warnings 0"].join(" && ");
}

export function unitTests(context: StepContext): string {
    const named = filesIn(context, VITEST_CONFIG).some((file) => UNIT_PROJECT.test(read(context, file) ?? ""));
    return countedVitest("unit-tests", named ? "pnpm exec vitest run --project unit" : "pnpm exec vitest run");
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
            title: "typecheck (tsc, every tsconfig*.json but the build one; tsc --showConfig keeps the strict options of the preset on)",
            profile,
            needs: ["pnpm"],
            after,
            run: typecheck,
            quick: (context) => (changedIn(context, CODE).length === 0 ? null : typecheck(context)),
            limitSeconds: 180,
        },
        {
            id: "lint",
            title: "lint (eslint; eslint --print-config of a source file keeps no-comments and boundaries at error)",
            profile,
            needs: ["pnpm"],
            after,
            run: lint,
            quick: (context) => withChanged(context, CODE, "pnpm exec eslint --no-warn-ignored --max-warnings 0"),
            limitSeconds: 300,
        },
        {
            id: "unit-tests",
            title: "unit tests (vitest, the project unit when the config has several; 0 tests run fails)",
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
