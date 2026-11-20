import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { quoted, type Io } from "./process.ts";
import { needServerProject, type DevSettings } from "./settings.ts";

export const SERVER_USAGE = `usage: suwgate dev server [dotnet run arguments]
The server under \`dotnet watch\`, rebuilt on every change, with the settings of the gitignored .env of the repository root.
\`suwgate dev tmux start\` runs it in its pane after \`suwgate dev db up\`. An edit hot reload cannot apply restarts the app
without asking, and when dotnet watch itself exits it is started again after a pause that grows while it keeps failing fast
(Ctrl+C stops it). Its JSON log is also written to dev.server.logFile, which \`suwgate dev logs\` reads.
Every argument goes to \`dotnet run\`.`;

export const QUICK_FAILURE_SECONDS = 60;
export const MAX_PAUSE_SECONDS = 60;
const INTERRUPTED = 130;

export function serverScript(project: string): string {
    return `set -a; if [ -f .env ]; then source .env; fi; set +a; exec dotnet watch --non-interactive --quiet --project ${quoted(project)} run "$@" 2>&1`;
}

export function nextPause(previous: number, ranSeconds: number): number {
    return ranSeconds >= QUICK_FAILURE_SECONDS ? 2 : Math.min(previous * 2, MAX_PAUSE_SECONDS);
}

export function serverArgv(settings: DevSettings, args: readonly string[]): string[] {
    return ["bash", "-c", serverScript(needServerProject(settings)), "suwgate-dev-server", ...args];
}

function runOnce(argv: readonly string[], settings: DevSettings, log: string, stopping: { requested: boolean }): Promise<number> {
    return new Promise((resolve) => {
        const [program = "", ...args] = argv;
        const child = spawn(program, args, { cwd: settings.root, stdio: ["inherit", "pipe", "inherit"] });
        const forward = () => {
            stopping.requested = true;
            child.kill("SIGTERM");
        };
        process.once("SIGINT", forward);
        process.once("SIGTERM", forward);
        child.stdout.on("data", (chunk: Buffer) => {
            process.stdout.write(chunk);
            appendFileSync(log, chunk);
        });
        child.on("close", (status) => {
            process.removeListener("SIGINT", forward);
            process.removeListener("SIGTERM", forward);
            resolve(status ?? 1);
        });
    });
}

export async function runServer(args: readonly string[], settings: DevSettings, io: Io): Promise<number> {
    const argv = serverArgv(settings, args);
    const log = path.join(settings.root, settings.logFile);
    mkdirSync(path.dirname(log), { recursive: true });
    writeFileSync(log, "");
    const stopping = { requested: false };
    let pause = 1;
    for (;;) {
        const started = Date.now();
        const status = await runOnce(argv, settings, log, stopping);
        if (stopping.requested) return INTERRUPTED;
        pause = nextPause(pause, (Date.now() - started) / 1000);
        io.err(`suwgate dev server: dotnet watch exited with code ${status}; starting it again in ${pause}s (Ctrl+C stops)`);
        await new Promise((resolve) => setTimeout(resolve, pause * 1000));
    }
}
