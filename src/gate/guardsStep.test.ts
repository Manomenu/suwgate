import { describe, expect, it } from "vitest";

import type { Config } from "./config.ts";
import type { Guard } from "./contract.ts";
import { runGuards } from "./guardsStep.ts";

const config = (exceptions: Config["exceptions"]): Config => ({
    profiles: ["dotnet"],
    directories: {},
    add: [],
    skip: [],
    configure: {},
    environment: {},
    skippedGuards: [],
    exceptions,
    settings: {},
});

const interfaces: Guard = {
    id: "two-implementations",
    description: "",
    profiles: "every",
    check: () => [
        { target: "Sdk.IClock", message: "one implementation" },
        { target: "App.IStore", message: "one implementation", line: 3 },
    ],
};

describe("the guards step", () => {
    it("fails on a finding no exception covers and names the guard, the target and the fix", async () => {
        const summary = await runGuards({ root: "/", guards: [interfaces], files: [], config: config([]) });

        expect(summary.passed).toBe(false);
        expect(summary.log.split("\n")).toEqual([
            "1 guard, 0 findings excepted in suwgate.yml",
            "two-implementations: Sdk.IClock: one implementation",
            "two-implementations: App.IStore:3: one implementation",
        ]);
    });

    it("lets an exception with its reason cover exactly its target", async () => {
        const summary = await runGuards({
            root: "/",
            guards: [interfaces],
            files: [],
            config: config([
                { guard: "two-implementations", target: "Sdk.IClock", reason: "the SDK takes it" },
                { guard: "two-implementations", target: "App.IStore", reason: "a second store is planned" },
            ]),
        });

        expect(summary).toEqual({ passed: true, log: "1 guard, 2 findings excepted in suwgate.yml" });
    });

    it("fails on an exception that no longer matches anything", async () => {
        const summary = await runGuards({
            root: "/",
            guards: [{ ...interfaces, check: () => [] }],
            files: [],
            config: config([{ guard: "two-implementations", target: "Sdk.IClock", reason: "the SDK takes it" }]),
        });

        expect(summary.passed).toBe(false);
        expect(summary.log).toContain("two-implementations: Sdk.IClock: the exception in suwgate.yml matches nothing any more: delete it");
    });

    it("lets an exception with a message cover only the findings of its target whose message contains it", async () => {
        const twoFindings: Guard = {
            ...interfaces,
            check: () => [
                { target: "Notes.Web/index.html", message: "a raw colour #fff on line 3" },
                { target: "Notes.Web/index.html", message: "a raw colour #000 on line 9" },
            ],
        };
        const narrowed = (message: string) =>
            runGuards({
                root: "/",
                guards: [twoFindings],
                files: [],
                config: config([{ guard: "two-implementations", target: "Notes.Web/index.html", message, reason: "the mail template" }]),
            });

        expect((await narrowed("#fff")).log.split("\n")).toEqual([
            "1 guard, 1 findings excepted in suwgate.yml",
            "two-implementations: Notes.Web/index.html: a raw colour #000 on line 9",
        ]);
        expect((await narrowed("#123")).log).toContain(
            "two-implementations: Notes.Web/index.html: the exception in suwgate.yml (message: #123) matches nothing any more: delete it",
        );
    });

    it("keeps a one-time exception that master already has from excepting anything, and from going stale", async () => {
        const once = { guard: "two-implementations", target: "Sdk.IClock", reason: "the owner approved the edit", once: true };
        const merged = await runGuards({
            root: "/",
            guards: [{ ...interfaces, check: () => [] }],
            files: [],
            config: config([once]),
            merged: [once],
        });
        const again = await runGuards({ root: "/", guards: [interfaces], files: [], config: config([once]), merged: [once] });
        const onItsBranch = await runGuards({ root: "/", guards: [{ ...interfaces, check: () => [] }], files: [], config: config([once]) });

        expect(merged).toEqual({
            passed: true,
            log: "1 guard, 0 findings excepted in suwgate.yml\ntwo-implementations: Sdk.IClock: the one-time exception is on master now and excepts nothing: delete it from suwgate.yml",
        });
        expect(again.passed).toBe(false);
        expect(again.log).toContain("two-implementations: Sdk.IClock: one implementation");
        expect(onItsBranch.passed).toBe(false);
    });

    it("turns a guard that throws into a finding instead of stopping the gate", async () => {
        const summary = await runGuards({
            root: "/",
            guards: [{ ...interfaces, check: () => Promise.reject(new Error("cannot read")) }],
            files: [],
            config: config([]),
        });

        expect(summary.passed).toBe(false);
        expect(summary.log).toContain("two-implementations: two-implementations: the guard itself failed: Error: cannot read");
    });
});
