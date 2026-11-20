import { describe, expect, it } from "vitest";

import type { Config } from "./config.ts";
import type { Guard } from "./contract.ts";
import { runGuards } from "./guardsStep.ts";

const config = (exceptions: Config["exceptions"]): Config => ({
    profiles: ["dotnet"],
    directories: {},
    add: [],
    skip: [],
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
