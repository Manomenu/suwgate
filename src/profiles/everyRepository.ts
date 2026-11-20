import type { Step } from "../gate/contract.ts";
import { criteriaStep } from "./criteria.ts";
import { composeFile } from "./database.ts";
import { withChanged } from "./shell.ts";

const SHELL_SCRIPT = /\.sh$|^\.githooks\/[^/]+$/;

export const everyRepositorySteps: readonly Step[] = [
    {
        id: "compose",
        title: "the compose stack resolves, with and without the db profile (docker compose config)",
        needs: ["docker"],
        run: (context) => (composeFile(context) ? "docker compose config --quiet && docker compose --profile db config --quiet" : null),
        limitSeconds: 120,
    },
    criteriaStep,
    {
        id: "shellcheck",
        title: "shell scripts (shellcheck)",
        needs: ["shellcheck"],
        run: "git ls-files --cached --others --exclude-standard -z -- '*.sh' '.githooks/*' | xargs -0 -r shellcheck -S warning",
        quick: (context) => withChanged(context, SHELL_SCRIPT, "shellcheck -S warning"),
        limitSeconds: 120,
    },
    {
        id: "gitleaks",
        title: "secrets in git and in the working tree (gitleaks)",
        needs: ["gitleaks"],
        run: [
            "if git rev-parse --verify -q HEAD >/dev/null; then gitleaks git . --no-banner --redact --log-level warn; fi",
            "gitleaks dir . --no-banner --redact --log-level warn --max-target-megabytes 1",
        ].join(" && "),
        limitSeconds: 300,
    },
];
