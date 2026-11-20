import type { Step, StepContext } from "../gate/contract.ts";
import { API_CONTRACT } from "./contract.ts";
import { DATABASE_UP } from "./database.ts";
import { DOTNET_BUILD, DOTNET_TEST } from "./dotnet.ts";
import { PNPM_INSTALL } from "./node.ts";
import { CHECKOUT_ENV, countedPlaywright, has, hasDevSection, quoted, script, suwgate } from "./shell.ts";

const E2E_CONFIG = "e2e/playwright.config.ts";

const PLAYWRIGHT = `pnpm exec playwright test -c ${E2E_CONFIG}`;

function e2e(context: StepContext): string | null {
    if (!has(context, E2E_CONFIG)) return null;
    if (!hasDevSection(context)) return script(["set -euo pipefail", ...countedPlaywright("e2e", PLAYWRIGHT)]);
    return script([
        "set -euo pipefail",
        ...CHECKOUT_ENV,
        'case "$E2E_DATABASE" in *e2e*) ;; *) echo "E2E_DATABASE is \\"$E2E_DATABASE\\": the e2e step drops and recreates it, so its name must contain e2e; never point it at the development database" >&2; exit 2 ;; esac',
        `${suwgate("dev db up")} >/dev/null`,
        `${suwgate("dev db psql")} -q -d postgres -c "DROP DATABASE IF EXISTS $E2E_DATABASE WITH (FORCE)" -c "CREATE DATABASE $E2E_DATABASE"`,
        `mkdir -p ${quoted(`${context.root}/.artifacts/logs`)}`,
        ...countedPlaywright("e2e", PLAYWRIGHT),
    ]);
}

export const webSteps: readonly Step[] = [
    {
        id: "e2e",
        title: `browser tests against the real server and a fresh database of this checkout (playwright, ${E2E_CONFIG}; 0 tests run fails)`,
        profile: "web",
        needs: ["pnpm"],
        after: [PNPM_INSTALL, DOTNET_BUILD, DATABASE_UP, DOTNET_TEST, API_CONTRACT],
        run: e2e,
        limitSeconds: 600,
    },
];
