import { describe, expect, it } from "vitest";

import { UsageError } from "./process.ts";
import { baseUrlOf, checkOne, parseSmoke, runSmoke, type Fetch } from "./smoke.ts";
import { recordingIo, settingsOf } from "./testing.ts";

const HEALTHY: Fetch = (url) =>
    Promise.resolve(url.endsWith("/healthz") ? { status: 200, body: "ok\n" } : { status: 200, body: '{"status":"ok"}' });

describe("dev smoke", () => {
    it("takes the base url from the argument or from the stack port, without a trailing slash", () => {
        const settings = settingsOf({ name: "x", portOffset: 60 });
        expect(baseUrlOf(settings, parseSmoke([]))).toBe("http://127.0.0.1:8250");
        expect(baseUrlOf(settings, parseSmoke(["http://host:1/"]))).toBe("http://host:1");
    });

    it.each([[["a", "b"]], [["--nope"]]])("refuses %j", (args) => {
        expect(() => parseSmoke(args)).toThrow(UsageError);
    });

    it("passes when every check answers 200 with its text", async () => {
        const { io, out, err } = recordingIo();
        expect(await runSmoke(parseSmoke([]), settingsOf(), HEALTHY, io)).toBe(0);
        expect(out).toEqual(["ok    /healthz", "ok    /api/health"]);
        expect(err).toEqual([]);
    });

    it("fails with the hint of the check that fails, and runs the rest", async () => {
        const fetcher: Fetch = (url) => Promise.resolve(url.endsWith("/healthz") ? { status: 200, body: "ok" } : { status: 502, body: "" });
        const { io, out, err } = recordingIo();
        expect(await runSmoke(parseSmoke([]), settingsOf(), fetcher, io)).toBe(1);
        expect(out).toEqual(["ok    /healthz"]);
        expect(err[0]).toContain("FAIL  http://127.0.0.1:8190/api/health: got status '502'");
        expect(err[0]).toContain("docker compose logs server");
    });

    it("calls a server that does not answer unreachable", async () => {
        const failure = await checkOne("http://x", { path: "/h", expect: "ok", hint: "look" }, () => Promise.reject(new Error("refused")));
        expect(failure).toBe("http://x/h: got status 'unreachable', expected 200 with 'ok' in the body. look");
    });

    it("matches the text as a pattern on any line, as grep did", async () => {
        const check = { path: "/h", expect: "^ok", hint: "" };
        expect(await checkOne("", check, () => Promise.resolve({ status: 200, body: "x\nok" }))).toBeNull();
        expect(await checkOne("", check, () => Promise.resolve({ status: 200, body: "not ok" }))).not.toBeNull();
    });

    it("runs the checks of the settings", async () => {
        const settings = settingsOf({ name: "x", smoke: { checks: [{ path: "/ready", expect: "yes", hint: "h" }] } });
        const { io, out } = recordingIo();
        await runSmoke(parseSmoke([]), settings, () => Promise.resolve({ status: 200, body: "yes" }), io);
        expect(out).toEqual(["ok    /ready"]);
    });
});
