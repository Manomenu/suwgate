import { describe, expect, it } from "vitest";

import { dev, DEV_USAGE, type DevEnvironment } from "./index.ts";
import { Failure } from "./process.ts";
import { fakeExec, recordingIo, settingsOf } from "./testing.ts";

function environment(load: DevEnvironment["loadSettings"] = () => settingsOf()): { env: DevEnvironment; out: string[]; err: string[] } {
    const { io, out, err } = recordingIo();
    const env: DevEnvironment = {
        cwd: "/repo",
        env: {},
        io,
        exec: fakeExec().exec,
        fetch: () => Promise.resolve({ status: 200, body: "" }),
        pause: () => Promise.resolve(),
        self: "suwgate",
        interactive: false,
        ask: () => Promise.resolve(""),
        loadSettings: load,
        discoverApi: () => ({ problem: "no project writes contract/openapi.json" }),
        temporaryFile: (name) => `/tmp/${name}`,
        onInterrupt: () => () => undefined,
    };
    return { env, out, err };
}

describe("suwgate dev", () => {
    it("lists its commands", async () => {
        const { env, out } = environment();
        expect(await dev(["--help"], env)).toBe(0);
        expect(out).toEqual([DEV_USAGE]);
        expect(await dev([], env)).toBe(2);
    });

    it("refuses an unknown command", async () => {
        const { env, err } = environment();
        expect(await dev(["nope"], env)).toBe(2);
        expect(err[0]).toContain('no command "nope"');
    });

    it.each(["db", "logs", "smoke", "server", "tmux", "sibling", "api-types", "slow-tests", "checkout-env"])(
        "prints the help of %s without reading suwgate.yml",
        async (command) => {
            const { env, out } = environment(() => {
                throw new Failure("no suwgate.yml");
            });
            expect(await dev([command, "--help"], env)).toBe(0);
            expect(out[0]).toContain(`suwgate dev ${command === "checkout-env" ? "" : command}`.trim());
        },
    );

    it("exits 2 with the problem of the discovery for api-types", async () => {
        const { env, err } = environment();
        expect(await dev(["api-types"], env)).toBe(2);
        expect(err).toEqual(["suwgate dev api-types: no project writes contract/openapi.json"]);
        expect(await dev(["api-types", "now"], env)).toBe(2);
    });

    it("exits 2 with the usage on a wrong argument, and with the failure's own code", async () => {
        const wrong = environment();
        expect(await dev(["db", "nope"], wrong.env)).toBe(2);
        expect(wrong.err[0]).toContain("usage: suwgate dev db");
        const failing = environment(() => {
            throw new Failure("suwgate.yml has no dev section", 2);
        });
        expect(await dev(["smoke"], failing.env)).toBe(2);
        expect(failing.err).toEqual(["suwgate.yml has no dev section"]);
    });

    it("runs a command with the settings of the repository", async () => {
        const { env, out } = environment();
        expect(await dev(["db", "up"], env)).toBe(0);
        expect(out).toEqual(["postgresql://myapp:myapp@localhost:5533/myapp"]);
    });
});
