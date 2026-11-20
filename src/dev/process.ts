import { spawn } from "node:child_process";

export class UsageError extends Error {}

export class Failure extends Error {
    readonly exitCode: number;

    constructor(message: string, exitCode = 1) {
        super(message);
        this.exitCode = exitCode;
    }
}

export interface ExecOptions {
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    capture?: boolean;
    quiet?: boolean;
}

export interface ExecResult {
    status: number;
    stdout: string;
}

export type Exec = (argv: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

export interface Io {
    out(text: string): void;
    err(text: string): void;
}

export function quoted(argument: string): string {
    return `'${argument.replaceAll("'", `'"'"'`)}'`;
}

export const exec: Exec = (argv, options = {}) =>
    new Promise((resolve) => {
        const [program = "", ...args] = argv;
        const stdio =
            options.capture === true
                ? ["inherit", "pipe", "inherit"]
                : options.quiet === true
                  ? ["inherit", "ignore", "ignore"]
                  : "inherit";
        const child = spawn(program, args, {
            cwd: options.cwd ?? process.cwd(),
            env: { ...process.env, ...options.env },
            stdio: stdio as "inherit",
        });
        let stdout = "";
        child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.on("error", (error) => {
            resolve({ status: 127, stdout: `${program}: ${error.message}` });
        });
        child.on("close", (status) => {
            resolve({ status: status ?? 1, stdout });
        });
    });
