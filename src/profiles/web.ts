import type { Step, StepContext } from "../gate/contract.ts";
import { API_CONTRACT } from "./contract.ts";
import { DATABASE_UP } from "./database.ts";
import { DOTNET_BUILD, DOTNET_TEST } from "./dotnet.ts";
import { PNPM_INSTALL } from "./node.ts";
import { CHECKOUT_ENV, countedPlaywright, has, hasDevSection, quoted, script, settingsOf, suwgate } from "./shell.ts";

const E2E = "e2e";

const E2E_CONFIG = "e2e/playwright.config.ts";

const PLAYWRIGHT = `pnpm exec playwright test -c ${E2E_CONFIG}`;

interface E2eSettings {
    before: string[];
}

const E2E_SETTINGS = {
    type: "object",
    additionalProperties: false,
    properties: {
        before: {
            description:
                "Commands run in the repository root after the database is fresh and before Playwright, in order (e.g. rm -rf .artifacts/e2e/versions); a failing one stops the step.",
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
        },
    },
};

function e2e(context: StepContext): string | null {
    if (!has(context, E2E_CONFIG)) return null;
    const before = (settingsOf<E2eSettings>(context, E2E).before ?? []).map((command) => `(cd ${quoted(context.root)} && ${command})`);
    const playwright = countedPlaywright(E2E, PLAYWRIGHT, null);
    if (!hasDevSection(context)) return script(["set -euo pipefail", ...before, ...playwright]);
    return script([
        "set -euo pipefail",
        ...CHECKOUT_ENV,
        'case "$E2E_DATABASE" in *e2e*) ;; *) echo "E2E_DATABASE is \\"$E2E_DATABASE\\": the e2e step drops and recreates it, so its name must contain e2e; never point it at the development database" >&2; exit 2 ;; esac',
        `${suwgate("dev db up")} >/dev/null`,
        `${suwgate("dev db psql")} -q -d postgres -c "DROP DATABASE IF EXISTS $E2E_DATABASE WITH (FORCE)" -c "CREATE DATABASE $E2E_DATABASE"`,
        `mkdir -p ${quoted(`${context.root}/.artifacts/logs`)}`,
        ...before,
        ...playwright,
    ]);
}

export const webSteps: readonly Step[] = [
    {
        id: E2E,
        title: `browser tests against the real server and a fresh database of this checkout (playwright, ${E2E_CONFIG}; 0 tests run fails)`,
        profile: "web",
        needs: ["pnpm"],
        after: [PNPM_INSTALL, DOTNET_BUILD, DATABASE_UP],
        orderAfter: [DOTNET_TEST, API_CONTRACT],
        run: e2e,
        args: "playwright test",
        settingsSchema: E2E_SETTINGS,
        limitSeconds: 600,
    },
];
