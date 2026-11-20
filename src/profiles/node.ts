import type { Profile, Step } from "../gate/contract.ts";
import { changedIn, withChanged } from "./shell.ts";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

export function nodeSteps(profile: Profile): Step[] {
    return [
        {
            id: "typecheck",
            title: "typecheck (tsc)",
            profile,
            needs: ["pnpm"],
            run: "pnpm exec tsc --noEmit -p tsconfig.json",
            quick: (context) => (changedIn(context, CODE).length === 0 ? null : "pnpm exec tsc --noEmit -p tsconfig.json"),
            limitSeconds: 180,
        },
        {
            id: "lint",
            title: "lint (eslint)",
            profile,
            needs: ["pnpm"],
            run: "pnpm exec eslint . --max-warnings 0",
            quick: (context) => withChanged(context, CODE, "pnpm exec eslint --no-warn-ignored --max-warnings 0"),
            limitSeconds: 300,
        },
        {
            id: "unit-tests",
            title: "unit tests (vitest)",
            profile,
            needs: ["pnpm"],
            run: "pnpm exec vitest run",
            limitSeconds: 300,
        },
        {
            id: "format",
            title: "format (prettier --check)",
            profile,
            needs: ["pnpm"],
            run: "pnpm exec prettier --check --log-level warn .",
            limitSeconds: 180,
        },
        {
            id: "knip",
            title: "dead code and unused dependencies (knip)",
            profile,
            needs: ["pnpm"],
            run: "pnpm exec knip",
            limitSeconds: 180,
        },
    ];
}
