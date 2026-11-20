import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function git(root: string, args: readonly string[]): string | null {
    try {
        return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return null;
    }
}

function lines(output: string | null): string[] {
    return (output ?? "")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
}

export function repositoryRoot(cwd: string): string | null {
    return git(cwd, ["rev-parse", "--show-toplevel"])?.trim() ?? null;
}

export function repositoryFiles(root: string): string[] {
    return lines(git(root, ["ls-files", "--cached", "--others", "--exclude-standard"])).filter((file) => existsSync(path.join(root, file)));
}

function changeBase(root: string): string | null {
    for (const branch of ["master", "origin/master"]) {
        const base = git(root, ["merge-base", "HEAD", branch])?.trim();
        if (base !== undefined && base.length > 0) return base;
    }
    return git(root, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() ?? null;
}

export function changedFiles(root: string): string[] {
    const base = changeBase(root);
    const committedOrStaged =
        base === null ? git(root, ["ls-files", "--cached"]) : git(root, ["diff", "--name-only", "--diff-filter=d", base]);
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
    return [...new Set([...lines(committedOrStaged), ...lines(untracked)])].sort();
}

export function fileOnMaster(root: string, file: string): string | null {
    for (const branch of ["master", "origin/master"]) {
        const base = git(root, ["merge-base", "HEAD", branch])?.trim();
        if (base !== undefined && base.length > 0) return git(root, ["show", `${base}:${file}`]);
    }
    return null;
}
