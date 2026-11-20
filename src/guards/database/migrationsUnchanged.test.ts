import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GuardContext } from "../../gate/contract.ts";
import { migrationsUnchanged } from "./migrationsUnchanged.ts";

const UP = "App/Database/Migrations/up";
let root = "";

function git(...args: string[]): void {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, stdio: "ignore" });
}

function write(file: string, text: string): void {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
}

async function findings(settings?: unknown) {
    const context: GuardContext = { root, files: [], profiles: ["database"], directories: {}, exceptions: [], settings, read: () => "" };
    return await migrationsUnchanged.check(context);
}

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "suwgate-migrations-"));
    git("init", "-q", "-b", "master");
    write(`${UP}/0001_create_notes.sql`, "create table notes ();");
    write(`${UP}/0002_add_index.sql`, "create index i on notes ();");
    write("README.md", "x");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature/x");
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("migrations-unchanged", () => {
    it("passes a new script and a change elsewhere", async () => {
        write(`${UP}/0003_add_tags.sql`, "create table tags ();");
        write("README.md", "y");
        git("add", ".");
        git("commit", "-q", "-m", "new");

        expect(await findings()).toEqual([]);
    });

    it("fails a changed script, committed or not, with the fix", async () => {
        write(`${UP}/0001_create_notes.sql`, "create table notes (id int);");

        const found = await findings();

        expect(found).toHaveLength(1);
        expect(found[0]?.target).toBe(`${UP}/0001_create_notes.sql`);
        expect(found[0]?.message).toContain("add a new numbered script");

        git("commit", "-q", "-am", "edit");
        expect(await findings()).toHaveLength(1);
    });

    it("fails a deleted script", async () => {
        rmSync(path.join(root, UP, "0002_add_index.sql"));

        const found = await findings();

        expect(found.map((finding) => finding.target)).toEqual([`${UP}/0002_add_index.sql`]);
        expect(found[0]?.message).toContain("restore it");
    });

    it("looks only in the configured folders when the setting names them", async () => {
        write(`${UP}/0001_create_notes.sql`, "changed");
        write("db/sql/0001_x.sql", "new");

        expect(await findings({ folders: ["db/sql"] })).toEqual([]);
        expect(await findings({ folders: [UP] })).toHaveLength(1);
    });

    it("passes where there is no master to compare with", async () => {
        git("branch", "-m", "feature/x", "other");
        git("branch", "-D", "master");
        write(`${UP}/0001_create_notes.sql`, "changed");

        expect(await findings()).toEqual([]);
    });
});
