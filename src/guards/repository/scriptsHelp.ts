import { spawnSync } from "node:child_process";

import type { Finding, Guard } from "../../gate/contract.ts";
import { baseName } from "./text.ts";

const TIMEOUT_MS = 30_000;

function helpFinding(root: string, script: string, text: string): Finding | null {
    if (!text.includes("--help") && !text.includes("usage:")) {
        return {
            target: script,
            message:
                "it does not handle --help, so it would run for real when an agent asks it what it does: print a usage text on --help and exit",
        };
    }
    const run = spawnSync("bash", [script, "--help"], {
        cwd: root,
        encoding: "utf8",
        timeout: TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (run.error !== undefined || run.signal !== null) {
        return {
            target: script,
            message: `--help did not finish within ${TIMEOUT_MS / 1000} s: print the usage text and exit before doing any work`,
        };
    }
    return run.stdout.length + run.stderr.length > 0
        ? null
        : { target: script, message: "--help printed nothing: print what the script does and how to call it" };
}

export const scriptsHelp: Guard = {
    id: "scripts-help",
    description: "Every shell script but the hooks answers --help with a usage text, so an agent asks it instead of reading it",
    profiles: "every",
    quick: false,
    check(context) {
        return context.files
            .filter((file) => file.endsWith(".sh") && !baseName(file).startsWith("hook-"))
            .flatMap((script) => helpFinding(context.root, script, context.read(script)) ?? []);
    },
};
