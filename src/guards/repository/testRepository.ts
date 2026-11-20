import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Finding, Guard, GuardContext } from "../../gate/contract.ts";

function contextOf(files: Readonly<Record<string, string>>, extra: Partial<GuardContext> = {}): GuardContext {
    return {
        root: "/repository",
        files: Object.keys(files),
        profiles: ["library"],
        directories: {},
        exceptions: [],
        settings: undefined,
        read: (file) => {
            const text = files[file];
            if (text === undefined) throw new Error(`${file} is not in the test repository`);
            return text;
        },
        ...extra,
    };
}

export async function findingsOf(
    guard: Guard,
    files: Readonly<Record<string, string>>,
    extra: Partial<GuardContext> = {},
): Promise<readonly Finding[]> {
    return guard.check(contextOf(files, extra));
}

export function shown(findings: readonly Finding[]): string[] {
    return findings.map((finding) => `${finding.target}${finding.line === undefined ? "" : `:${finding.line}`}`);
}

export function gitRepository(files: Readonly<Record<string, string>>, executable: readonly string[] = []): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-repository-"));
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
        if (executable.includes(file)) chmodSync(path.join(root, file), 0o755);
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    return root;
}
