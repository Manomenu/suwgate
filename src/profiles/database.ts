import type { Step, StepContext } from "../gate/contract.ts";
import { databaseUpCommand, has, script, suwgate } from "./shell.ts";

export const DATABASE_UP = "database-up";

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

const IN_CI =
    'if [ -n "${CI:-}" ]; then echo "CI: the workflow starts the database (database: true of the reusable gate workflow)"; exit 0; fi';

const UP = script([
    IN_CI,
    "docker compose --profile db up -d --wait db >/dev/null 2>&1 || {",
    '    echo "postgres did not start — see: docker compose --profile db logs db" >&2',
    "    exit 1",
    "}",
]);

const OWN_UP = script([IN_CI, `${suwgate("dev db up")} >/dev/null`]);

function databaseUp(context: StepContext): string | null {
    if (databaseUpCommand(context) !== null) return OWN_UP;
    return composeFile(context) ? UP : null;
}

export function composeFile(context: StepContext): boolean {
    return COMPOSE_FILES.some((file) => has(context, file));
}

export const databaseSteps: readonly Step[] = [
    {
        id: DATABASE_UP,
        title: "the local database for the tests (docker compose --profile db up --wait db, or dev.database.up of suwgate.yml; in CI the workflow starts it)",
        profile: "database",
        needs: ["docker"],
        run: databaseUp,
        limitSeconds: 120,
    },
];
