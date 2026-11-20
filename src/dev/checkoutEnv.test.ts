import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkoutEnv, cksum, exportLines, isLinkedWorktree, runCheckoutEnv, suffixOf } from "./checkoutEnv.ts";
import { Failure } from "./process.ts";
import { recordingIo, settingsOf } from "./testing.ts";

const MAIN = { checkoutName: "myapp", linked: false, ci: false, env: {}, settings: settingsOf() };
const WORKTREE = { ...MAIN, checkoutName: "myapp-wt1", linked: true };

function asRecord(variables: readonly (readonly [string, string])[]): Record<string, string> {
    return Object.fromEntries(variables);
}

describe("dev checkout-env", () => {
    it.each([
        ["myapp-wt1", 3594335456],
        ["suwgate-dev", 1458490625],
        ["", 4294967295],
        ["a", 1220704766],
    ])("hashes %j like cksum(1)", (name, expected) => {
        expect(cksum(name)).toBe(expected);
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

    it("gives a linked worktree its own databases and a port pair from the hash of its name", () => {
        const { variables, notice } = checkoutEnv(WORKTREE);
        expect(asRecord(variables)).toMatchObject({
            E2E_DATABASE: "myapp_e2e_myapp_wt1_3594335456",
            TEST_CONNECTION_STRING: "Host=127.0.0.1;Port=5533;Database=myapp_test_myapp_wt1_3594335456;Username=myapp;Password=myapp",
            E2E_SERVER_PORT: "20912",
            E2E_WEB_PORT: "20913",
        });
        expect(notice).toBe(
            "checkout myapp-wt1: test database myapp_test_myapp_wt1_3594335456, e2e database myapp_e2e_myapp_wt1_3594335456, e2e ports 20912/20913",
        );
    });

    it("lets a value of the environment win", () => {
        const { variables } = checkoutEnv({ ...WORKTREE, env: { E2E_SERVER_PORT: "7000", E2E_DATABASE: "" } });
        expect(asRecord(variables)).toMatchObject({ E2E_SERVER_PORT: "7000", E2E_DATABASE: "myapp_e2e_myapp_wt1_3594335456" });
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
        expect(suffixOf("My Worktree.With-A-Very-Long-Name-That-Goes-On")).toMatch(/^my_worktree_with_a_very_long_n_\d+$/);
        expect(suffixOf("a".repeat(60))).toHaveLength(30 + 1 + String(cksum("a".repeat(60))).length);
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

    it("tells a linked worktree from the main checkout, and says when it is no checkout", () => {
        const base = realpathSync(mkdtempSync(path.join(tmpdir(), "suwgate-wt-")));
        const main = path.join(base, "main");
        const linked = path.join(base, "linked");
        mkdirSync(main);
        const git = (...args: string[]) =>
            execFileSync("git", ["-C", main, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
        git("init", "-q");
        git("commit", "-q", "--allow-empty", "-m", "x");
        git("worktree", "add", "-q", linked);
        expect(isLinkedWorktree(main)).toBe(false);
        expect(isLinkedWorktree(linked)).toBe(true);
        expect(() => isLinkedWorktree(path.join(tmpdir()))).toThrow(Failure);
    });
});
