import { describe, expect, it } from "vitest";

import { Failure, UsageError } from "./process.ts";
import {
    baseUrlOf,
    checkOne,
    loopbackOverride,
    parseSmoke,
    publishedPorts,
    runSmoke,
    runSmokeCi,
    type Fetch,
    type SmokeCiEnvironment,
} from "./smoke.ts";
import { fakeExec, recordingIo, settingsOf } from "./testing.ts";

const HEALTHY: Fetch = (url) =>
    Promise.resolve(url.endsWith("/healthz") ? { status: 200, body: "ok\n" } : { status: 200, body: '{"status":"ok"}' });

describe("dev smoke", () => {
    it("takes the base url from the argument or from the stack port, without a trailing slash", () => {
        const settings = settingsOf({ name: "x", portOffset: 60 });
        expect(baseUrlOf(settings, parseSmoke([]))).toBe("http://127.0.0.1:8250");
        expect(baseUrlOf(settings, parseSmoke(["http://host:1/"]))).toBe("http://host:1");
    });

    it.each([[["a", "b"]], [["--nope"]], [["--ci", "http://host:1"]]])("refuses %j", (args) => {
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

const CONFIG = JSON.stringify({
    services: {
        db: { ports: [{ target: 5432, published: "5533", host_ip: "127.0.0.1", protocol: "tcp" }] },
        mail: {
            ports: [
                { target: 1025, published: "1085", protocol: "tcp" },
                { target: 8025, published: "8085", protocol: "udp" },
            ],
        },
        server: {},
        web: { ports: [{ target: 8080, published: "8190", host_ip: "127.0.0.1", protocol: "tcp" }] },
    },
});

function ciEnvironment(answer: (argv: readonly string[]) => { status?: number; stdout?: string }, fetcher: Fetch = HEALTHY) {
    const { exec, calls } = fakeExec(answer);
    const { io, out, err } = recordingIo();
    const files: Record<string, string> = {};
    const interrupts: (readonly string[])[] = [];
    let released = 0;
    const environment: SmokeCiEnvironment = {
        settings: settingsOf(),
        exec,
        fetch: fetcher,
        io,
        temporaryFile: (name, text) => {
            files[name] = text;
            return `/tmp/x/${name}`;
        },
        onInterrupt: (cleanup) => {
            interrupts.push(cleanup);
            return () => (released += 1);
        },
    };
    return { environment, calls, out, err, files, interrupts, released: () => released };
}

function stack(overrides: Record<string, { status?: number; stdout?: string }> = {}) {
    return (argv: readonly string[]): { status?: number; stdout?: string } => {
        const verb = argv.includes("config") ? "config" : (argv.find((word) => ["up", "port", "logs", "down"].includes(word)) ?? "");
        if (verb in overrides) return overrides[verb] ?? {};
        if (verb === "config") return { stdout: CONFIG };
        if (verb === "port") return { stdout: "127.0.0.1:49153\n" };
        return {};
    };
}

const PROJECT = ["docker", "compose", "-f", "/repo/compose.yaml", "-f", "/tmp/x/compose.ci.yaml", "-p", "myapp-ci", "--profile", "db"];

describe("dev smoke --ci", () => {
    it("reads every published port of the resolved compose file", () => {
        expect(publishedPorts(CONFIG)).toEqual([
            { service: "db", target: 5432, published: "5533", protocol: "tcp" },
            { service: "mail", target: 1025, published: "1085", protocol: "tcp" },
            { service: "mail", target: 8025, published: "8085", protocol: "udp" },
            { service: "web", target: 8080, published: "8190", protocol: "tcp" },
        ]);
    });

    it("moves every published port to a free loopback port, so no fixed host port is taken", () => {
        expect(loopbackOverride(publishedPorts(CONFIG))).toBe(
            [
                "services:",
                "  db:",
                "    ports: !override",
                '      - "127.0.0.1::5432"',
                "  mail:",
                "    ports: !override",
                '      - "127.0.0.1::1025"',
                '      - "127.0.0.1::8025/udp"',
                "  web:",
                "    ports: !override",
                '      - "127.0.0.1::8080"',
                "",
            ].join("\n"),
        );
    });

    it("builds and starts its own project with the image tag ci, smoke-tests the port standing for dev.ports.stack, and removes it", async () => {
        const { environment, calls, out, files, interrupts, released } = ciEnvironment(stack());
        expect(await runSmokeCi(environment)).toBe(0);
        expect(calls.map((call) => call.argv)).toEqual([
            ["docker", "compose", "-f", "/repo/compose.yaml", "-p", "myapp-ci", "--profile", "db", "config", "--format", "json"],
            [...PROJECT, "up", "-d", "--build", "--wait"],
            [...PROJECT, "port", "web", "8080"],
            [...PROJECT, "down", "--remove-orphans", "--volumes"],
        ]);
        expect(calls.every((call) => call.options?.env?.["IMAGE_TAG"] === "ci")).toBe(true);
        expect(files["compose.ci.yaml"]).toContain('"127.0.0.1::8080"');
        expect(out).toEqual(["ok    /healthz", "ok    /api/health"]);
        expect(interrupts).toEqual([[...PROJECT, "down", "--remove-orphans", "--volumes"]]);
        expect(released()).toBe(1);
    });

    it("asks the stack's own port for the address", async () => {
        const urls: string[] = [];
        const fetcher: Fetch = (url) => {
            urls.push(url);
            return HEALTHY(url);
        };
        const { environment } = ciEnvironment(stack({ port: { stdout: "0.0.0.0:40001\n" } }), fetcher);
        await runSmokeCi(environment);
        expect(urls).toEqual(["http://127.0.0.1:40001/healthz", "http://127.0.0.1:40001/api/health"]);
    });

    it.each([
        ["a stack that does not start healthy", { up: { status: 1 } }, "the stack did not start healthy"],
        ["a web with no published port", { port: { status: 1 } }, "web publishes no port for 8080"],
    ])("fails on %s, prints the logs and still removes the project", async (_name, overrides, message) => {
        const { environment, calls, err } = ciEnvironment(stack(overrides));
        expect(await runSmokeCi(environment)).toBe(1);
        expect(err[0]).toContain(message);
        expect(calls.map((call) => call.argv.slice(PROJECT.length).join(" ")).slice(-2)).toEqual([
            "logs --no-color",
            "down --remove-orphans --volumes",
        ]);
    });

    it("prints the logs when a smoke check fails, and removes the project", async () => {
        const failing: Fetch = () => Promise.resolve({ status: 502, body: "" });
        const { environment, calls } = ciEnvironment(stack(), failing);
        expect(await runSmokeCi(environment)).toBe(1);
        expect(calls.map((call) => call.argv.at(-1))).toContain("--no-color");
        expect(calls.at(-1)?.argv.slice(PROJECT.length)).toEqual(["down", "--remove-orphans", "--volumes"]);
    });

    it("says when the project could not be removed, and keeps the smoke result", async () => {
        const { environment, err } = ciEnvironment(stack({ down: { status: 1 } }));
        expect(await runSmokeCi(environment)).toBe(0);
        expect(err).toEqual([expect.stringContaining("the project myapp-ci was not removed")]);
    });

    it("refuses a compose file in which no service publishes dev.ports.stack, before starting anything", async () => {
        const { environment, calls } = ciEnvironment(
            stack({ config: { stdout: JSON.stringify({ services: { web: { ports: [{ target: 80, published: "9000" }] } } }) } }),
        );
        await expect(runSmokeCi(environment)).rejects.toBeInstanceOf(Failure);
        await expect(runSmokeCi(environment)).rejects.toThrow("publishes dev.ports.stack (8190)");
        expect(calls.every((call) => call.argv.includes("config"))).toBe(true);
    });

    it("refuses a compose file that does not resolve", async () => {
        const { environment } = ciEnvironment(stack({ config: { status: 1 } }));
        await expect(runSmokeCi(environment)).rejects.toThrow("the compose file does not resolve");
    });
});
