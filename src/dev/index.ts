import { execFileSync } from "node:child_process";

import { askOnTerminal, DB_USAGE, parseDb, runDb } from "./db.ts";
import { CHECKOUT_ENV_USAGE, runCheckoutEnv } from "./checkoutEnv.ts";
import { LOGS_USAGE, parseLogs, runLogs } from "./logs.ts";
import { exec, Failure, UsageError, type Exec, type Io } from "./process.ts";
import { runServer, SERVER_USAGE } from "./server.ts";
import { loadSettings, type DevSettings } from "./settings.ts";
import { parseSmoke, realFetch, runSmoke, SMOKE_USAGE, type Fetch } from "./smoke.ts";
import { parseTmux, runTmux, TMUX_USAGE } from "./tmux.ts";

export const DEV_USAGE = `usage: suwgate dev <db|logs|smoke|server|tmux|checkout-env> [arguments]   (every one takes --help)
The dev scripts of the template as commands, configured by the dev section of suwgate.yml:
  db            the local PostgreSQL of the compose file: up | down | reset | psql | logs | status
  logs          why did it fail? the last warnings and errors of the server's JSON log
  smoke         read-only requests against a running stack
  server        the server under dotnet watch, restarted when it exits
  tmux          the whole local stack in one tmux session: start [--restart] | stop
  checkout-env  eval "$(suwgate dev checkout-env)": own test databases and e2e ports for a linked worktree`;

const USAGES: Readonly<Record<string, string>> = {
    db: DB_USAGE,
    logs: LOGS_USAGE,
    smoke: SMOKE_USAGE,
    server: SERVER_USAGE,
    tmux: TMUX_USAGE,
    "checkout-env": CHECKOUT_ENV_USAGE,
};

export interface DevEnvironment {
    cwd: string;
    env: Readonly<Record<string, string | undefined>>;
    io: Io;
    exec: Exec;
    fetch: Fetch;
    self: string;
    interactive: boolean;
    ask: (question: string) => Promise<string>;
    loadSettings: (cwd: string) => DevSettings;
}

function repositoryRootOf(cwd: string): string {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return cwd;
    }
}

function realEnvironment(): DevEnvironment {
    return {
        cwd: process.cwd(),
        env: process.env,
        io: { out: (text) => console.log(text), err: (text) => console.error(text) },
        exec,
        fetch: realFetch,
        self: `${JSON.stringify(process.execPath)} ${JSON.stringify(process.argv[1] ?? "suwgate")}`,
        interactive: process.stdin.isTTY,
        ask: askOnTerminal,
        loadSettings: (cwd) => loadSettings(repositoryRootOf(cwd)),
    };
}

async function dispatch(command: string, args: readonly string[], environment: DevEnvironment): Promise<number> {
    const { io } = environment;
    const settings = (): DevSettings => environment.loadSettings(environment.cwd);
    switch (command) {
        case "db": {
            const parsed = parseDb(args);
            return runDb(parsed, {
                settings: settings(),
                exec: environment.exec,
                io,
                interactive: environment.interactive,
                ask: environment.ask,
            });
        }
        case "logs":
            return runLogs(parseLogs(args), settings(), environment.exec, io, environment.cwd);
        case "smoke":
            return runSmoke(parseSmoke(args), settings(), environment.fetch, io);
        case "server":
            return runServer(args, settings(), io);
        case "tmux":
            return runTmux(parseTmux(args), {
                settings: settings(),
                exec: environment.exec,
                io,
                env: environment.env,
                self: environment.self,
            });
        default:
            return runCheckoutEnv(args, settings(), environment.env, io);
    }
}

export async function dev(argv: readonly string[], environment: DevEnvironment = realEnvironment()): Promise<number> {
    const [command, ...args] = argv;
    if (command === undefined || command === "--help") {
        environment.io.out(DEV_USAGE);
        return command === undefined ? 2 : 0;
    }
    const usage = USAGES[command];
    if (usage === undefined) {
        environment.io.err(`suwgate dev: no command "${command}"\n${DEV_USAGE}`);
        return 2;
    }
    if (args[0] === "--help") {
        environment.io.out(usage);
        return 0;
    }
    try {
        return await dispatch(command, args, environment);
    } catch (error) {
        if (error instanceof UsageError) {
            environment.io.err(error.message);
            return 2;
        }
        if (error instanceof Failure) {
            environment.io.err(error.message);
            return error.exitCode;
        }
        throw error;
    }
}
