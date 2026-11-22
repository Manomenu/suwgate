import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

import { API_TYPES_USAGE, parseApiTypes, runApiTypes, type DiscoverApi } from "./apiTypes.ts";
import { askOnTerminal, DB_USAGE, parseDb, runDb } from "./db.ts";
import { CHECKOUT_ENV_USAGE, runCheckoutEnv } from "./checkoutEnv.ts";
import { LOGS_USAGE, parseLogs, runLogs } from "./logs.ts";
import { exec, Failure, UsageError, type Exec, type Io } from "./process.ts";
import { runServer, SERVER_USAGE } from "./server.ts";
import { loadSettings, type DevSettings } from "./settings.ts";
import { parseSlowTests, runSlowTests, SLOW_TESTS_USAGE } from "./slowTests.ts";
import { parseSibling, runSibling, SIBLING_USAGE } from "./sibling.ts";
import { parseSmoke, realFetch, runSmoke, runSmokeCi, SMOKE_USAGE, type Fetch, type SmokeCiEnvironment } from "./smoke.ts";
import { parseTmux, runTmux, TMUX_USAGE } from "./tmux.ts";

export const DEV_USAGE = `usage: suwgate dev <db|logs|smoke|server|tmux|sibling|api-types|slow-tests|checkout-env> [arguments]   (every one takes --help)
The dev scripts of the template as commands, configured by the dev section of suwgate.yml:
  db            the local PostgreSQL of the compose file: up | down | reset | psql | logs | status
  logs          why did it fail? the last warnings and errors of the server's JSON log
  smoke         read-only requests against a running stack; --ci builds and starts its own stack first
  server        the server under dotnet watch, restarted when it exits
  tmux          the whole local stack in one tmux session: start [--restart] | stop
  sibling       the images of a sibling repository, rebuilt from its checkout when stale: <name> image | up | rebuild | down | status
  api-types     regenerate the API contract and the web app's types from the server, as the api-contract step generates them
  slow-tests    a report of the slowest .NET tests: -n <count>, default 10
  checkout-env  eval "$(suwgate dev checkout-env)": own test databases and e2e ports for a linked worktree`;

const USAGES: Readonly<Record<string, string>> = {
    db: DB_USAGE,
    logs: LOGS_USAGE,
    smoke: SMOKE_USAGE,
    server: SERVER_USAGE,
    tmux: TMUX_USAGE,
    sibling: SIBLING_USAGE,
    "api-types": API_TYPES_USAGE,
    "slow-tests": SLOW_TESTS_USAGE,
    "checkout-env": CHECKOUT_ENV_USAGE,
};

export interface DevEnvironment {
    cwd: string;
    env: Readonly<Record<string, string | undefined>>;
    io: Io;
    exec: Exec;
    fetch: Fetch;
    pause: (milliseconds: number) => Promise<void>;
    self: string;
    interactive: boolean;
    ask: (question: string) => Promise<string>;
    loadSettings: (cwd: string) => DevSettings;
    discoverApi: DiscoverApi;
    temporaryFile: SmokeCiEnvironment["temporaryFile"];
    onInterrupt: SmokeCiEnvironment["onInterrupt"];
}

function repositoryRootOf(cwd: string): string {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return cwd;
    }
}

function temporaryFile(name: string, text: string): string {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "suwgate-")), name);
    writeFileSync(file, text);
    return file;
}

const INTERRUPTED = 130;

function onInterrupt(cleanup: readonly string[]): () => void {
    const [program = "", ...args] = cleanup;
    const stop = (): void => {
        try {
            execFileSync(program, args, { stdio: "inherit" });
        } finally {
            process.exit(INTERRUPTED);
        }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    };
}

export function realEnvironment(discoverApi: DiscoverApi): DevEnvironment {
    return {
        cwd: process.cwd(),
        env: process.env,
        io: { out: (text) => console.log(text), err: (text) => console.error(text) },
        exec,
        fetch: realFetch,
        pause: async (milliseconds) => {
            await pause(milliseconds);
        },
        self: `${JSON.stringify(process.execPath)} ${JSON.stringify(process.argv[1] ?? "suwgate")}`,
        interactive: process.stdin.isTTY,
        ask: askOnTerminal,
        loadSettings: (cwd) => loadSettings(repositoryRootOf(cwd)),
        discoverApi,
        temporaryFile,
        onInterrupt,
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
        case "smoke": {
            const parsed = parseSmoke(args);
            if (!parsed.ci) return runSmoke(parsed, settings(), environment.fetch, io);
            const { exec, fetch } = environment;
            return runSmokeCi({
                settings: settings(),
                exec,
                fetch,
                io,
                temporaryFile: environment.temporaryFile,
                onInterrupt: environment.onInterrupt,
            });
        }
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
        case "sibling": {
            const parsed = parseSibling(args);
            if (parsed.kind === "help") {
                io.out(parsed.text);
                return 0;
            }
            const { exec, fetch } = environment;
            return runSibling(parsed, { settings: settings(), exec, fetch, io, pause: environment.pause });
        }
        case "api-types": {
            parseApiTypes(args);
            const found = environment.discoverApi(environment.cwd);
            if ("problem" in found) throw new Failure(`suwgate dev api-types: ${found.problem}`, 2);
            return runApiTypes({ root: found.root, layout: found.layout, exec: environment.exec, io });
        }
        case "slow-tests":
            return runSlowTests(parseSlowTests(args), { settings: settings(), env: environment.env, exec: environment.exec, io });
        default:
            return runCheckoutEnv(args, settings(), environment.env, io);
    }
}

export async function dev(argv: readonly string[], environment: DevEnvironment): Promise<number> {
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
