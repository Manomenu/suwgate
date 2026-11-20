import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHOWN_LINES = 60;

function git(root: string, args: readonly string[]): Buffer {
    try {
        return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 30 });
    } catch {
        return Buffer.alloc(0);
    }
}

function fingerprint(root: string): string {
    const hash = createHash("sha256");
    hash.update(git(root, ["rev-parse", "HEAD"]));
    hash.update(git(root, ["diff", "HEAD", "--binary"]));
    for (const file of git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0")) {
        const full = path.join(root, file);
        if (file !== "" && existsSync(full)) hash.update(file).update(readFileSync(full));
    }
    return hash.digest("hex");
}

export interface StopVerdict {
    exitCode: 0 | 2;
    message: string;
}

export async function stop(
    input: string,
    root: string,
    quickCheck: () => Promise<{ exitCode: number; text: string }>,
): Promise<StopVerdict> {
    if (/"stop_hook_active"\s*:\s*true/.test(input)) return { exitCode: 0, message: "" };
    const marker = path.resolve(root, git(root, ["rev-parse", "--git-path", "suwgate-quick-green"]).toString("utf8").trim());
    const now = fingerprint(root);
    if (existsSync(marker) && readFileSync(marker, "utf8").trim() === now) return { exitCode: 0, message: "" };
    const result = await quickCheck();
    if (result.exitCode === 0) {
        writeFileSync(marker, `${now}\n`);
        return { exitCode: 0, message: "" };
    }
    const shown = result.text.split("\n").slice(-SHOWN_LINES).join("\n");
    return { exitCode: 2, message: `The quick gate (suwgate check --quick) is red. Fix it before finishing:\n${shown}` };
}
