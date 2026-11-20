import { createInterface } from "node:readline/promises";

import { Failure, UsageError, type Exec, type Io } from "./process.ts";
import type { DevSettings } from "./settings.ts";

export const DB_USAGE = `usage: suwgate dev db up | down | reset [--yes] | psql [psql args] | logs | status
The local PostgreSQL for development and tests: the database service of the compose file (dev.compose), published on the
loopback, its data in a named volume that survives down. Needs docker (on Fedora: podman behind the docker command).
  up       start it (and dev.compose.extraServices), or leave it running, and wait until it answers; prints its address
  down     stop it, the data stays in the volume
  reset    delete the containers and the volume with all the data, after asking (--yes does not ask)
  psql     psql in it as its owner in the app's database, e.g. suwgate dev db psql -d postgres -c "select 1"
  logs     follow its log
  status   what runs`;

export type DbCommand =
    { kind: "up" | "down" | "logs" | "status" } | { kind: "reset"; yes: boolean } | { kind: "psql"; args: readonly string[] };

export function parseDb(args: readonly string[]): DbCommand {
    const [command, ...rest] = args;
    switch (command) {
        case "psql":
            return { kind: "psql", args: rest };
        case "reset":
            if (rest.length === 0) return { kind: "reset", yes: false };
            if (rest.length === 1 && rest[0] === "--yes") return { kind: "reset", yes: true };
            throw new UsageError("suwgate dev db reset takes only --yes");
        case "up":
        case "down":
        case "logs":
        case "status":
            if (rest.length > 0) throw new UsageError(`suwgate dev db ${command} takes no arguments`);
            return { kind: command };
        default:
            throw new UsageError(DB_USAGE);
    }
}

export function composeBase(settings: DevSettings): string[] {
    return ["docker", "compose", "-f", `${settings.root}/${settings.compose.file}`, "--profile", settings.compose.profile];
}

function databaseServices(settings: DevSettings): string[] {
    return [settings.compose.databaseService, ...settings.compose.extraServices];
}

export function databaseUrl(settings: DevSettings): string {
    const { user, password, name } = settings.database;
    return `postgresql://${user}:${password}@localhost:${settings.ports.database}/${name}`;
}

export function dbArgv(settings: DevSettings, command: DbCommand, interactive: boolean): string[] {
    const base = composeBase(settings);
    const service = settings.compose.databaseService;
    switch (command.kind) {
        case "up":
            return [...base, "up", "-d", "--wait", ...databaseServices(settings)];
        case "down":
            return [...base, "stop", ...databaseServices(settings)];
        case "reset":
            return [...base, "down", "--volumes"];
        case "psql":
            return [
                ...base,
                "exec",
                ...(interactive ? [] : ["-T"]),
                service,
                "psql",
                "-U",
                settings.database.user,
                "-d",
                settings.database.name,
                ...command.args,
            ];
        case "logs":
            return [...base, "logs", "-f", service];
        case "status":
            return [...base, "ps", "-a", ...databaseServices(settings)];
    }
}

export interface DbEnvironment {
    settings: DevSettings;
    exec: Exec;
    io: Io;
    interactive: boolean;
    ask: (question: string) => Promise<string>;
}

export function askOnTerminal(question: string): Promise<string> {
    const lines = createInterface({ input: process.stdin, output: process.stderr });
    return lines.question(question).finally(() => {
        lines.close();
    });
}

export async function runDb(command: DbCommand, environment: DbEnvironment): Promise<number> {
    const { settings, exec, io } = environment;
    if (command.kind === "reset" && !command.yes) {
        const answer = await environment.ask("Delete the local database with all its data? [y/N] ");
        if (answer.trim() !== "y") {
            io.out("nothing deleted");
            return 1;
        }
    }
    const argv = dbArgv(settings, command, environment.interactive);
    if (command.kind === "up") {
        const { status } = await exec(argv, { quiet: true });
        if (status !== 0) {
            throw new Failure(
                `suwgate dev db: postgres did not start; see: ${composeBase(settings).join(" ")} logs ${settings.compose.databaseService}`,
            );
        }
        io.out(databaseUrl(settings));
        return 0;
    }
    const { status } = await exec(argv);
    if (status === 0 && command.kind === "down") io.out("stopped (the data stays in the volume)");
    if (status === 0 && command.kind === "reset") io.out("deleted; `suwgate dev db up` starts an empty one");
    return status;
}
