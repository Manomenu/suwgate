import { UsageError, Failure, quoted, type Exec, type Io } from "./process.ts";
import { needServerProject, needWebDirectory, type DevSettings } from "./settings.ts";

export const TMUX_USAGE = `usage: suwgate dev tmux start [--restart] | suwgate dev tmux stop
The local stack in one tmux session, <dev.name>-dev:
  left:  a shell in the repository
  right: the server under dotnet watch (+ the database of the compose file) / the web app under pnpm dev, with hot reload
The session is reused when it exists; --restart kills it (and everything running in it) first; stop kills it and stops there.
In a tmux pane the client is switched, not nested; any other terminal attaches where it was called.
TMUX_DEV_NO_ATTACH=1 builds the session and stops there (used to inspect the layout).`;

export type TmuxCommand = { kind: "start"; restart: boolean } | { kind: "stop" };

const SESSION_WIDTH = 220;
const SESSION_HEIGHT = 50;

export function parseTmux(args: readonly string[]): TmuxCommand {
    const [command, ...rest] = args;
    if (command === "start" && rest.length === 0) return { kind: "start", restart: false };
    if (command === "start" && rest.length === 1 && rest[0] === "--restart") return { kind: "start", restart: true };
    if (command === "stop" && rest.length === 0) return { kind: "stop" };
    throw new UsageError(TMUX_USAGE);
}

export function sessionName(settings: DevSettings): string {
    return `${settings.name}-dev`;
}

export function paneCommands(settings: DevSettings, self: string): { server: string; web: string } {
    return {
        server: `${self} dev db up && ${self} dev server`,
        web: `cd ${quoted(needWebDirectory(settings))} && { [ -d node_modules ] || pnpm install; } && pnpm dev`,
    };
}

export interface TmuxEnvironment {
    settings: DevSettings;
    exec: Exec;
    io: Io;
    env: Readonly<Record<string, string | undefined>>;
    self: string;
}

async function tmux(environment: TmuxEnvironment, args: readonly string[], capture = false): Promise<{ status: number; stdout: string }> {
    const result = await environment.exec(["tmux", ...args], { cwd: environment.settings.root, capture, quiet: !capture });
    return { status: result.status, stdout: result.stdout.trim() };
}

export async function inTmuxPane(environment: TmuxEnvironment): Promise<boolean> {
    if ((environment.env["TMUX"] ?? "") === "") return false;
    const panes = await tmux(environment, ["list-panes", "-a", "-F", "#{pane_tty}"], true);
    const here = await environment.exec(["tty"], { capture: true });
    if (here.status !== 0) return false;
    return panes.stdout.split("\n").includes(here.stdout.trim());
}

async function running(environment: TmuxEnvironment): Promise<boolean> {
    return (await tmux(environment, ["has-session", "-t", `=${sessionName(environment.settings)}`])).status === 0;
}

async function insideSession(environment: TmuxEnvironment): Promise<boolean> {
    if (!(await inTmuxPane(environment))) return false;
    return (await tmux(environment, ["display-message", "-p", "#S"], true)).stdout === sessionName(environment.settings);
}

async function attach(environment: TmuxEnvironment): Promise<void> {
    if (environment.env["TMUX_DEV_NO_ATTACH"] === "1") return;
    const session = sessionName(environment.settings);
    if (await inTmuxPane(environment)) {
        await environment.exec(["tmux", "switch-client", "-t", session]);
    } else {
        await environment.exec(["env", "-u", "TMUX", "tmux", "attach-session", "-t", session]);
    }
}

export async function buildSession(environment: TmuxEnvironment): Promise<void> {
    const { settings } = environment;
    needServerProject(settings);
    const session = sessionName(settings);
    const root = settings.root;
    const commands = paneCommands(settings, environment.self);
    const pane = async (args: readonly string[]): Promise<string> => (await tmux(environment, args, true)).stdout;
    const shell = await pane([
        "new-session",
        "-d",
        "-s",
        session,
        "-c",
        root,
        "-x",
        String(SESSION_WIDTH),
        "-y",
        String(SESSION_HEIGHT),
        "-P",
        "-F",
        "#{pane_id}",
    ]);
    const server = await pane(["split-window", "-h", "-t", shell, "-c", root, "-P", "-F", "#{pane_id}"]);
    const web = await pane(["split-window", "-v", "-t", server, "-c", root, "-P", "-F", "#{pane_id}"]);
    await tmux(environment, ["set-option", "-t", session, "pane-border-status", "top"]);
    await tmux(environment, ["select-pane", "-t", shell, "-T", "shell"]);
    await tmux(environment, ["select-pane", "-t", server, "-T", `server: (${settings.ports.server})`]);
    await tmux(environment, ["select-pane", "-t", web, "-T", `web: (${settings.ports.web})`]);
    await tmux(environment, ["send-keys", "-t", server, commands.server, "Enter"]);
    await tmux(environment, ["send-keys", "-t", web, commands.web, "Enter"]);
    await tmux(environment, ["select-pane", "-t", shell]);
}

export async function runTmux(command: TmuxCommand, environment: TmuxEnvironment): Promise<number> {
    const { io, settings } = environment;
    const session = sessionName(settings);
    if ((await environment.exec(["tmux", "-V"], { capture: true })).status !== 0) {
        throw new Failure("tmux is not installed. Install it: sudo dnf install tmux");
    }
    if (command.kind === "stop") {
        if (!(await running(environment))) {
            io.out(`No ${session} session is running.`);
            return 0;
        }
        if (!(await insideSession(environment))) io.out(`Stopping the ${session} session.`);
        await tmux(environment, ["kill-session", "-t", `=${session}`]);
        return 0;
    }
    if (command.restart && (await running(environment))) {
        if (await insideSession(environment)) {
            throw new Failure(
                `Run --restart from outside the ${session} session: killing it would end this shell before the new one starts.`,
            );
        }
        await tmux(environment, ["kill-session", "-t", `=${session}`]);
    }
    if (!(await running(environment))) await buildSession(environment);
    await attach(environment);
    return 0;
}
