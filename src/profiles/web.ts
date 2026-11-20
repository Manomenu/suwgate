import type { Step } from "../gate/contract.ts";
import { API_CONTRACT } from "./contract.ts";
import { DATABASE_UP } from "./database.ts";
import { DOTNET_BUILD, DOTNET_TEST } from "./dotnet.ts";
import { PNPM_INSTALL } from "./node.ts";
import { has } from "./shell.ts";

const E2E_CONFIG = "e2e/playwright.config.ts";

export const webSteps: readonly Step[] = [
    {
        id: "e2e",
        title: `browser tests against the real server and database (playwright, ${E2E_CONFIG})`,
        profile: "web",
        needs: ["pnpm"],
        after: [PNPM_INSTALL, DOTNET_BUILD, DATABASE_UP, DOTNET_TEST, API_CONTRACT],
        run: (context) => (has(context, E2E_CONFIG) ? `pnpm exec playwright test -c ${E2E_CONFIG}` : null),
        limitSeconds: 600,
    },
];
