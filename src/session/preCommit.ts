import { spawn } from "node:child_process";

export interface ToolResult {
    missing: boolean;
    exitCode: number;
    text: string;
}

export type RunTool = (command: string, args: readonly string[], cwd: string) => Promise<ToolResult>;

export interface PreCommitVerdict {
    exitCode: 0 | 1;
    message: string;
}

export const GITLEAKS_ARGS = ["git", "--pre-commit", "--staged", "--no-banner", "--redact", "--log-level", "warn"] as const;

export const runTool: RunTool = (command, args, cwd) =>
    new Promise((resolve) => {
        const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let text = "";
        child.stdout.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        child.on("error", (error: NodeJS.ErrnoException) =>
            resolve({ missing: error.code === "ENOENT", exitCode: 1, text: error.message }),
        );
        child.on("close", (code) => resolve({ missing: false, exitCode: code ?? 1, text }));
    });

export async function preCommit(
    root: string,
    run: RunTool,
    quickCheck: () => Promise<{ exitCode: number; text: string }>,
): Promise<PreCommitVerdict> {
    const leaks = await run("gitleaks", GITLEAKS_ARGS, root);
    if (leaks.missing) {
        return {
            exitCode: 1,
            message:
                "pre-commit: gitleaks not found, so the staged changes cannot be checked for secrets: install it (https://github.com/gitleaks/gitleaks); commit refused",
        };
    }
    if (leaks.exitCode !== 0) {
        return {
            exitCode: 1,
            message: `${leaks.text.trimEnd()}\npre-commit: possible secret in the staged changes (above): remove it, and rotate it if it is real; commit refused`,
        };
    }
    const quick = await quickCheck();
    if (quick.exitCode !== 0) {
        return {
            exitCode: 1,
            message: `${quick.text.trimEnd()}\npre-commit: the quick gate is red (above): fix it before committing; commit refused`,
        };
    }
    return { exitCode: 0, message: "" };
}
