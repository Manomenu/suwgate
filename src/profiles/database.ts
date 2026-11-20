import type { Step, StepContext } from "../gate/contract.ts";
import { has, script } from "./shell.ts";

export const DATABASE_UP = "database-up";

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

const UP = script([
    'if [ -n "${CI:-}" ]; then echo "CI: the workflow provides the database as a service"; exit 0; fi',
    "docker compose --profile db up -d --wait db >/dev/null 2>&1 || {",
    '    echo "postgres did not start — see: docker compose --profile db logs db" >&2',
    "    exit 1",
    "}",
]);

export function composeFile(context: StepContext): boolean {
    return COMPOSE_FILES.some((file) => has(context, file));
}

export const databaseSteps: readonly Step[] = [
    {
        id: DATABASE_UP,
        title: "the local database for the tests (docker compose --profile db up --wait db; CI provides its own)",
        profile: "database",
        needs: ["docker"],
        run: (context) => (composeFile(context) ? UP : null),
        limitSeconds: 120,
    },
];
