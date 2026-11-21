import type { Step, StepContext } from "../gate/contract.ts";
import { databaseUpCommand, has, hasDevSection, script, suwgate } from "./shell.ts";

export const DATABASE_UP = "database-up";

const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

const COMPOSE_UP = script([
    "docker compose --profile db up -d --wait db >/dev/null 2>&1 || {",
    '    echo "postgres did not start — see: docker compose --profile db logs db" >&2',
    "    exit 1",
    "}",
]);

const DEV_UP = `${suwgate("dev db up")} >/dev/null`;

function databaseUp(context: StepContext): string | null {
    if (databaseUpCommand(context) !== null) return DEV_UP;
    if (!composeFile(context)) return null;
    return hasDevSection(context) ? DEV_UP : COMPOSE_UP;
}

export function composeFile(context: StepContext): boolean {
    return COMPOSE_FILES.some((file) => has(context, file));
}

export const databaseSteps: readonly Step[] = [
    {
        id: DATABASE_UP,
        title: "the database for the tests, locally and in CI (suwgate dev db up with a dev section in suwgate.yml, else docker compose --profile db up --wait db)",
        profile: "database",
        needs: ["docker"],
        run: databaseUp,
        limitSeconds: 120,
    },
];
