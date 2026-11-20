import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkoutEnv, checkoutHash, exportLines, gitCheckout, runCheckoutEnv, suffixOf } from "./checkoutEnv.ts";
import { Failure } from "./process.ts";
import { recordingIo, settingsOf } from "./testing.ts";

const MAIN = { checkoutName: "myapp", repository: "/repos/myapp/.git", linked: false, ci: false, env: {}, settings: settingsOf() };
const WORKTREE = { ...MAIN, checkoutName: "myapp-wt1", linked: true };

function asRecord(variables: readonly (readonly [string, string])[]): Record<string, string> {
    return Object.fromEntries(variables);
}

describe("dev checkout-env", () => {
    it("hashes the repository with the worktree's name, the same on every run", () => {
        expect(checkoutHash("/repos/myapp/.git", "myapp-wt1")).toBe(checkoutHash("/repos/myapp/.git", "myapp-wt1"));
        expect(checkoutHash("/repos/myapp/.git", "wt")).not.toBe(checkoutHash("/repos/other/.git", "wt"));
        expect(checkoutHash("/repos/myapp/.git", "wt1")).not.toBe(checkoutHash("/repos/myapp/.git", "wt2"));
    });

    it("keeps the plain names and ports in the main checkout", () => {
        const { variables, notice } = checkoutEnv(MAIN);
        expect(asRecord(variables)).toEqual({
            MSBUILDDISABLENODEREUSE: "1",
            DOTNET_CLI_USE_MSBUILD_SERVER: "0",
            E2E_DATABASE: "myapp_e2e",
            E2E_SERVER_PORT: "6301",
            E2E_WEB_PORT: "3301",
        });
        expect(notice).toBeNull();
    });

    it("keeps the plain names in CI even in a worktree", () => {
        expect(asRecord(checkoutEnv({ ...WORKTREE, ci: true }).variables)["E2E_DATABASE"]).toBe("myapp_e2e");
    });

    it("gives a linked worktree its own databases and a port pair from the hash of its repository and name", () => {
        const hash = checkoutHash(WORKTREE.repository, WORKTREE.checkoutName);
        const server = 20000 + (hash % 5000) * 2;
        const { variables, notice } = checkoutEnv(WORKTREE);
        expect(asRecord(variables)).toMatchObject({
            E2E_DATABASE: `myapp_e2e_myapp_wt1_${hash}`,
            TEST_CONNECTION_STRING: `Host=127.0.0.1;Port=5533;Database=myapp_test_myapp_wt1_${hash};Username=myapp;Password=myapp`,
            E2E_SERVER_PORT: String(server),
            E2E_WEB_PORT: String(server + 1),
        });
        expect(notice).toBe(
            `checkout myapp-wt1: test database myapp_test_myapp_wt1_${hash}, e2e database myapp_e2e_myapp_wt1_${hash}, e2e ports ${server}/${server + 1}`,
        );
    });

    it("gives same-named worktrees of two repositories other databases and ports", () => {
        const values = (repository: string) => {
            const record = asRecord(checkoutEnv({ ...WORKTREE, checkoutName: "feature-x", repository }).variables);
            return [record["E2E_DATABASE"], record["TEST_CONNECTION_STRING"], record["E2E_SERVER_PORT"], record["E2E_WEB_PORT"]];
        };
        const [database, test, server, web] = values("/repos/template/.git");
        const [otherDatabase, otherTest, otherServer, otherWeb] = values("/repos/alfusion/.git");
        expect(otherDatabase).not.toBe(database);
        expect(otherTest).not.toBe(test);
        expect(otherServer).not.toBe(server);
        expect(otherWeb).not.toBe(web);
    });

    it("lets a value of the environment win", () => {
        const { variables } = checkoutEnv({ ...WORKTREE, env: { E2E_SERVER_PORT: "7000", E2E_DATABASE: "" } });
        const hash = checkoutHash(WORKTREE.repository, WORKTREE.checkoutName);
        expect(asRecord(variables)).toMatchObject({ E2E_SERVER_PORT: "7000", E2E_DATABASE: `myapp_e2e_myapp_wt1_${hash}` });
    });

    it("uses the ports and names of the settings", () => {
        const settings = settingsOf({ name: "alfusion", portOffset: 60 });
        expect(asRecord(checkoutEnv({ ...MAIN, settings }).variables)).toMatchObject({
            E2E_SERVER_PORT: "6361",
            E2E_WEB_PORT: "3361",
            E2E_DATABASE: "alfusion_e2e",
        });
        expect(asRecord(checkoutEnv({ ...WORKTREE, settings }).variables)["TEST_CONNECTION_STRING"]).toContain(
            "Port=5593;Database=alfusion_test_",
        );
    });

    it("keeps a suffix a database name can hold: 30 lower-case characters, then the hash", () => {
        expect(suffixOf("My Worktree.With-A-Very-Long-Name-That-Goes-On", 42)).toBe("my_worktree_with_a_very_long_n_42");
        expect(suffixOf("a".repeat(60), 4294967295)).toBe(`${"a".repeat(30)}_4294967295`);
    });

    it("prints export lines a shell can eval", () => {
        expect(
            exportLines([
                ["A", "it's"],
                ["B", "x y"],
            ]),
        ).toBe(`export A='it'"'"'s'\nexport B='x y'`);
    });

    it("prints the notice to stderr and the exports to stdout", () => {
        const { io, out, err } = recordingIo();
        const root = realpathSync(mkdtempSync(path.join(tmpdir(), "suwgate-env-")));
        expect(runCheckoutEnv([], { ...settingsOf(), root }, { CI: "1" }, io)).toBe(0);
        expect(out[0]).toContain("export MSBUILDDISABLENODEREUSE='1'");
        expect(err).toEqual([]);
        expect(runCheckoutEnv(["x"], settingsOf(), {}, io)).toBe(2);
    });

    const repositoryWithWorktree = (base: string, worktree: string) => {
        const main = path.join(base, "main");
        const linked = path.join(base, "worktrees", worktree);
        mkdirSync(main, { recursive: true });
        const git = (...args: string[]) =>
            execFileSync("git", ["-C", main, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
        git("init", "-q");
        git("commit", "-q", "--allow-empty", "-m", "x");
        git("worktree", "add", "-q", linked);
        return { main, linked };
    };

    it("tells a linked worktree from the main checkout, and says when it is no checkout", () => {
        const { main, linked } = repositoryWithWorktree(realpathSync(mkdtempSync(path.join(tmpdir(), "suwgate-wt-"))), "linked");
        expect(gitCheckout(main)).toEqual({ repository: path.join(main, ".git"), linked: false });
        expect(gitCheckout(linked)).toEqual({ repository: path.join(main, ".git"), linked: true });
        expect(() => gitCheckout(path.join(tmpdir()))).toThrow(Failure);
    });

    it("prints other ports and databases for same-named worktrees of two repositories, and the same ones on every run", () => {
        const base = realpathSync(mkdtempSync(path.join(tmpdir(), "suwgate-wt-")));
        const isolated = ["E2E_DATABASE", "TEST_CONNECTION_STRING", "E2E_SERVER_PORT", "E2E_WEB_PORT"];
        const exported = (root: string) => {
            const { io, out } = recordingIo();
            runCheckoutEnv([], { ...settingsOf(), root }, {}, io);
            return isolated.map((name) => new RegExp(`^export ${name}=(.+)$`, "m").exec(out.join("\n"))?.[1]);
        };
        const template = repositoryWithWorktree(path.join(base, "template"), "suwgate-0.5").linked;
        const alfusion = repositoryWithWorktree(path.join(base, "alfusion"), "suwgate-0.5").linked;
        const [first, again, other] = [exported(template), exported(template), exported(alfusion)];
        expect(first.every((value) => value !== undefined)).toBe(true);
        expect(again).toEqual(first);
        first.forEach((value, index) => expect(other[index]).not.toBe(value));
    });
});
