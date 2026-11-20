import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { composeBase } from "./db.ts";
import { Failure, UsageError, type Exec, type Io } from "./process.ts";
import type { DevSettings } from "./settings.ts";

export const LOGS_USAGE = `usage: suwgate dev logs [--all] [--trace <id>] [--compose] [-n N] [--file <path>]
Why did it fail? One command, short output, from the server's JSON log lines.
  (no option)      the last warnings and errors of the newest log in the folder of dev.server.logFile
  --all            every level
  --trace <id>     every line of one request: the traceId of an error response (32 hex digits or the W3C form)
  --compose        read the compose server (docker compose logs) instead of a file
  -n 50            the last 50 lines (default 20)
  --file <path>    a specific log file
One line each: time level category trace=... message, and for an exception its type and first line.
The logs are written by the server of \`suwgate dev server\` and by the browser tests of the repository.`;

export interface LogsCommand {
    all: boolean;
    trace: string;
    compose: boolean;
    count: number;
    file: string;
}

const SHOWN_LEVELS = ["Warning", "Error", "Critical"];
const MESSAGE_LIMIT = 300;
const EXCEPTION_LIMIT = 200;
const LEVEL_WIDTH = 11;

export function parseLogs(args: readonly string[]): LogsCommand {
    let values;
    try {
        ({ values } = parseArgs({
            args: [...args],
            strict: true,
            options: {
                all: { type: "boolean" },
                trace: { type: "string" },
                compose: { type: "boolean" },
                n: { type: "string", short: "n" },
                file: { type: "string" },
            },
        }));
    } catch (error) {
        throw new UsageError(`${error instanceof Error ? error.message : String(error)}\n${LOGS_USAGE}`);
    }
    const count = values.n === undefined ? 20 : Number(values.n);
    if (!Number.isInteger(count) || count < 1) throw new UsageError(`-n needs a positive number, got "${values.n}"`);
    const traceText = values.trace;
    let trace = "";
    if (traceText !== undefined) {
        const match = /[0-9a-f]{32}/i.exec(traceText);
        if (match === null) throw new UsageError("that is not a traceId (32 hex digits, or 00-<32 hex>-<16 hex>-<2 hex>)");
        trace = match[0].toLowerCase();
    }
    return {
        all: values.all === true || trace !== "",
        trace,
        compose: values.compose === true,
        count,
        file: values.file ?? "",
    };
}

function field(record: Record<string, unknown>, name: string): string {
    const value = record[name];
    return typeof value === "string" ? value : "";
}

function oneLine(value: string): string {
    return value.replace(/\s*[\r\n]+\s*/g, " ");
}

export function formatLine(line: string, command: Pick<LogsCommand, "all" | "trace">): string | null {
    if (!line.startsWith("{")) return null;
    let record: Record<string, unknown>;
    try {
        record = JSON.parse(line) as Record<string, unknown>;
    } catch {
        return null;
    }
    const level = field(record, "LogLevel");
    if (command.trace !== "" && !line.includes(command.trace)) return null;
    if (!command.all && !SHOWN_LEVELS.includes(level)) return null;
    const traceId = field(record, "TraceId");
    const exception = field(record, "Exception").split(/[\r\n]/, 1)[0] ?? "";
    const shownException = exception === "" ? "" : ` | ${exception.slice(0, EXCEPTION_LIMIT)}`;
    const shownTrace = traceId === "" ? "" : ` trace=${traceId}`;
    const message = oneLine(field(record, "Message")).slice(0, MESSAGE_LIMIT);
    return `${field(record, "Timestamp")} ${level.padEnd(LEVEL_WIDTH)} ${field(record, "Category")}${shownTrace} ${message}${shownException}`;
}

export function formatLog(content: string, command: LogsCommand): string[] {
    const shown = content.split("\n").flatMap((line) => formatLine(line, command) ?? []);
    return shown.slice(-command.count);
}

export function newestLog(directory: string): string | null {
    let names: string[];
    try {
        names = readdirSync(directory).filter((name) => name.endsWith(".jsonl"));
    } catch {
        return null;
    }
    const files = names.map((name) => ({ file: path.join(directory, name), time: statSync(path.join(directory, name)).mtimeMs }));
    return files.sort((left, right) => right.time - left.time)[0]?.file ?? null;
}

export async function runLogs(command: LogsCommand, settings: DevSettings, exec: Exec, io: Io, cwd: string): Promise<number> {
    let sourceName: string;
    let content: string;
    if (command.compose) {
        const service = settings.compose.serverService;
        sourceName = `docker compose logs ${service}`;
        const result = await exec([...composeBase(settings), "logs", "--no-log-prefix", "--no-color", service], { capture: true });
        content = result.stdout;
    } else {
        const file =
            command.file === "" ? newestLog(path.dirname(path.join(settings.root, settings.logFile))) : path.resolve(cwd, command.file);
        if (file === null) {
            throw new Failure(
                "suwgate dev logs: no log file yet. Start the server with `suwgate dev tmux start` (or `suwgate dev server`), or run the browser tests (they write the logs), or read the container stack with --compose.",
            );
        }
        try {
            content = readFileSync(file, "utf8");
        } catch {
            throw new Failure(`suwgate dev logs: cannot read ${file}`);
        }
        sourceName = path.relative(settings.root, file);
    }
    io.out(`# ${sourceName}`);
    for (const line of formatLog(content, command)) io.out(line);
    return 0;
}
