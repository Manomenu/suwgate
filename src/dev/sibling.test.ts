import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Failure, UsageError } from "./process.ts";
import { resolveSettings } from "./settings.ts";
import { parseSibling, runSibling, SIBLING_USAGE, type SiblingCommand, type SiblingEnvironment } from "./sibling.ts";
import type { Fetch } from "./smoke.ts";
import { fakeExec, recordingIo } from "./testing.ts";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const IMAGES: Record<string, string> = { "cms-server:local": "sha256:server-1", "cms-web:local": "sha256:web-1" };
const REBUILT: Record<string, string> = { "cms-server:local": "sha256:server-2", "cms-web:local": "sha256:web-2" };
const SIBLING = {
    images: Object.keys(IMAGES),
    compose: "cms/compose.yaml",
    health: "http://localhost:8225/api/health",
};

interface World {
    head?: string | null;
    changes?: string;
    images?: Record<string, string>;
    built?: Record<string, string>;
    buildStatus?: number;
    running?: boolean;
    state?: unknown;
}

function repository(state: unknown): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-sibling-"));
    if (state !== undefined) {
        mkdirSync(path.join(root, ".artifacts/dev/siblings"), { recursive: true });
        writeFileSync(path.join(root, ".artifacts/dev/siblings/cms.json"), JSON.stringify(state));
    }
    return root;
}

function setup(
    world: World = {},
    sibling: Record<string, unknown> = SIBLING,
    fetcher: Fetch = () => Promise.resolve({ status: 200, body: "" }),
) {
    const root = repository(world.state);
    let images = world.images ?? IMAGES;
    const { exec, calls } = fakeExec((argv) => {
        const command = argv.join(" ");
        if (command.includes("rev-parse HEAD")) return world.head === null ? { status: 128 } : { stdout: `${world.head ?? HEAD}\n` };
        if (command.includes("status --porcelain")) return { stdout: world.changes ?? "" };
        if (command.startsWith("docker image inspect")) {
            const id = images[argv.at(-1) ?? ""];
            return id === undefined ? { status: 1 } : { stdout: `${id}\n` };
        }
        if (argv[0] === "bash") {
            images = world.built ?? REBUILT;
            return { status: world.buildStatus ?? 0 };
        }
        if (command.endsWith("ps -q")) return { stdout: world.running === true ? "c0ffee\n" : "" };
        return {};
    });
    const { io, out, err } = recordingIo();
    const pauses: number[] = [];
    const environment: SiblingEnvironment = {
        settings: resolveSettings({ name: "chat", siblings: { cms: sibling } }, {}, root),
        exec,
        fetch: fetcher,
        io,
        pause: (milliseconds) => {
            pauses.push(milliseconds);
            return Promise.resolve();
        },
    };
    const builds = (): number => calls.filter((call) => call.argv[0] === "bash").length;
    const state = (): unknown => JSON.parse(readFileSync(path.join(root, ".artifacts/dev/siblings/cms.json"), "utf8"));
    return { root, environment, calls, out, err, pauses, builds, state };
}

const RECORDED = { revision: HEAD, images: IMAGES };

function run(action: "image" | "up" | "rebuild" | "down" | "status", environment: SiblingEnvironment): Promise<number> {
    return runSibling({ kind: "run", name: "cms", action }, environment);
}

async function failureOf(work: Promise<unknown>): Promise<Failure> {
    try {
        await work;
    } catch (error) {
        if (error instanceof Failure) return error;
        throw error;
    }
    throw new Error("expected a failure");
}

describe("dev sibling: arguments", () => {
    it.each<[string[], SiblingCommand]>([
        [[], { kind: "list" }],
        [["cms", "image"], { kind: "run", name: "cms", action: "image" }],
        [["cms", "down"], { kind: "run", name: "cms", action: "down" }],
        [["cms", "--help"], { kind: "help", text: SIBLING_USAGE }],
    ])("reads %j", (args, expected) => {
        expect(parseSibling(args)).toEqual(expected);
    });

    it.each(["image", "up", "rebuild", "down", "status"])("prints the help of %s", (action) => {
        const parsed = parseSibling(["cms", action, "--help"]);
        expect(parsed.kind === "help" ? parsed.text : "").toContain(`usage: suwgate dev sibling <name> ${action}`);
    });

    it.each([[["cms"]], [["cms", "start"]], [["cms", "up", "now"]], [["--all"]]])("refuses %j with the usage", (args) => {
        expect(() => parseSibling(args)).toThrow(UsageError);
    });
});

describe("dev sibling image", () => {
    it.each<[string, World]>([
        ["the image cms-web:local is missing", { state: RECORDED, images: { "cms-server:local": "sha256:server-1" } }],
        ["suwgate has no record of the commit they were built from", {}],
        ["the images are from fedcba987, the checkout is at 012345678", { state: { ...RECORDED, revision: OTHER } }],
        [
            "the image cms-server:local is not the one suwgate built (rebuilt or pulled since)",
            { state: RECORDED, images: { ...IMAGES, "cms-server:local": "sha256:pulled" } },
        ],
        ["the checkout at 012345678 has uncommitted changes", { state: RECORDED, changes: "?? notes.txt\n" }],
    ])("rebuilds when %s, then records the build", async (reason, world) => {
        const { environment, calls, out, builds, state } = setup(world);

        expect(await run("image", environment)).toBe(0);

        expect(out).toEqual([`cms: rebuilding, ${reason}`]);
        expect(builds()).toBe(1);
        expect(calls.find((call) => call.argv[0] === "bash")).toEqual({
            argv: ["bash", "-c", "docker compose build"],
            options: { cwd: path.resolve(environment.settings.root, "../cms") },
        });
        expect(state()).toEqual({ revision: HEAD, images: REBUILT });
    });

    it("builds nothing when the images are what the clean checkout holds", async () => {
        const { environment, out, builds } = setup({ state: RECORDED });

        expect(await run("image", environment)).toBe(0);

        expect(out).toEqual(["cms: the images are current (012345678)"]);
        expect(builds()).toBe(0);
    });

    it("runs the images as they are without a checkout, and says how to set it", async () => {
        const { environment, out, builds } = setup({ head: null });

        expect(await run("image", environment)).toBe(0);

        expect(out[0]).toContain("there is no git checkout of cms at");
        expect(out[0]).toContain("so its images run as they are: clone it there, or set dev.siblings.cms.checkout in suwgate.yml");
        expect(builds()).toBe(0);
    });

    it("fails when an image is missing and there is no checkout to build it from", async () => {
        const { environment, builds } = setup({ head: null, images: {} });

        const failure = await failureOf(run("image", environment));

        expect(failure.exitCode).toBe(1);
        expect(failure.message).toContain("the image cms-server:local is missing and there is no git checkout of cms");
        expect(failure.message).toContain("set dev.siblings.cms.checkout");
        expect(builds()).toBe(0);
    });

    it("fails on a failed build and records nothing", async () => {
        const { root, environment } = setup({ buildStatus: 2 });

        const failure = await failureOf(run("image", environment));

        expect(failure.exitCode).toBe(1);
        expect(failure.message).toContain("cms: the build failed (exit 2): docker compose build in");
        expect(existsSync(path.join(root, ".artifacts/dev/siblings/cms.json"))).toBe(false);
    });

    it("fails and records nothing when the build does not make an image it names", async () => {
        const { root, environment } = setup({ built: { "cms-server:local": "sha256:server-2" } });

        const failure = await failureOf(run("image", environment));

        expect(failure.message).toContain("made no image cms-web:local");
        expect(existsSync(path.join(root, ".artifacts/dev/siblings/cms.json"))).toBe(false);
    });

    it("runs the build of the settings in the checkout of the settings", async () => {
        const { environment, calls } = setup({}, { ...SIBLING, checkout: "../elsewhere/cms", build: "just images" });

        await run("image", environment);

        expect(calls.find((call) => call.argv[0] === "bash")).toEqual({
            argv: ["bash", "-c", "just images"],
            options: { cwd: path.resolve(environment.settings.root, "../elsewhere/cms") },
        });
    });
});

describe("dev sibling up", () => {
    it("makes the images current, starts the compose file and waits until health answers", async () => {
        const { root, environment, calls, out } = setup({ state: RECORDED });

        expect(await run("up", environment)).toBe(0);

        expect(calls.map((call) => call.argv)).toContainEqual(["docker", "compose", "-f", `${root}/cms/compose.yaml`, "up", "-d"]);
        expect(out).toEqual(["cms: the images are current (012345678)", "cms: http://localhost:8225"]);
    });

    it("says up without health", async () => {
        const { environment, out } = setup({ state: RECORDED }, { images: SIBLING.images, compose: SIBLING.compose });

        await run("up", environment);

        expect(out.at(-1)).toBe("cms: up");
    });

    it("refuses without compose, with exit 2, and names image", async () => {
        const { environment, builds } = setup({}, { images: SIBLING.images });

        const failure = await failureOf(run("up", environment));

        expect(failure.exitCode).toBe(2);
        expect(failure.message).toContain("suwgate dev sibling cms up needs dev.siblings.cms.compose");
        expect(failure.message).toContain("suwgate dev sibling cms image makes the images current");
        expect(builds()).toBe(0);
    });

    it("fails after 2 minutes of no answer, with the command that shows the logs", async () => {
        const { root, environment, pauses } = setup({ state: RECORDED }, SIBLING, () => Promise.resolve({ status: 503, body: "" }));

        const failure = await failureOf(run("up", environment));

        expect(failure.exitCode).toBe(1);
        expect(failure.message).toBe(
            `cms did not answer at http://localhost:8225/api/health within 2 minutes: see docker compose -f ${root}/cms/compose.yaml logs`,
        );
        expect(pauses.reduce((sum, milliseconds) => sum + milliseconds, 0)).toBeLessThan(2 * 60 * 1000);
        expect(pauses.length).toBeGreaterThan(1);
    });

    it("waits through a health check that does not answer yet", async () => {
        let asked = 0;
        const fetcher: Fetch = () => {
            asked += 1;
            return asked < 3 ? Promise.reject(new Error("refused")) : Promise.resolve({ status: 204, body: "" });
        };
        const { environment, out, pauses } = setup({ state: RECORDED }, SIBLING, fetcher);

        expect(await run("up", environment)).toBe(0);

        expect(pauses).toHaveLength(2);
        expect(out.at(-1)).toBe("cms: http://localhost:8225");
    });
});

describe("dev sibling rebuild, down, status and the list", () => {
    it("rebuilds current images and recreates the running stack", async () => {
        const { root, environment, calls, builds, state } = setup({ state: RECORDED, running: true });

        expect(await run("rebuild", environment)).toBe(0);

        expect(builds()).toBe(1);
        expect(state()).toEqual({ revision: HEAD, images: REBUILT });
        expect(calls.map((call) => call.argv)).toContainEqual(["docker", "compose", "-f", `${root}/cms/compose.yaml`, "up", "-d"]);
    });

    it("rebuilds without starting a stack that does not run", async () => {
        const { environment, calls, out } = setup({ state: RECORDED });

        await run("rebuild", environment);

        expect(calls.some((call) => call.argv.includes("up"))).toBe(false);
        expect(out).toEqual(["cms: rebuilding from 012345678"]);
    });

    it("refuses to rebuild without a checkout", async () => {
        const { environment } = setup({ head: null });

        expect((await failureOf(run("rebuild", environment))).message).toContain("there is no git checkout of cms at");
    });

    it("stops the stack and keeps its volumes", async () => {
        const { root, environment, calls } = setup();

        expect(await run("down", environment)).toBe(0);

        expect(calls.map((call) => call.argv)).toEqual([["docker", "compose", "-f", `${root}/cms/compose.yaml`, "down"]]);
    });

    it("says whether health answers, what compose runs and whether the images are current, building nothing", async () => {
        const { root, environment, calls, out, builds } = setup({ state: { ...RECORDED, revision: OTHER } }, SIBLING, () =>
            Promise.reject(new Error("refused")),
        );

        expect(await run("status", environment)).toBe(0);

        expect(out).toEqual([
            "cms: does not answer at http://localhost:8225/api/health: suwgate dev sibling cms up starts it",
            "cms: the images are not current, the images are from fedcba987, the checkout is at 012345678: suwgate dev sibling cms image rebuilds them",
        ]);
        expect(calls.map((call) => call.argv)).toContainEqual(["docker", "compose", "-f", `${root}/cms/compose.yaml`, "ps"]);
        expect(builds()).toBe(0);
    });

    it("lists every sibling with its checkout and whether its images are current", async () => {
        const { environment, out } = setup({ state: RECORDED });

        expect(await runSibling({ kind: "list" }, environment)).toBe(0);

        expect(out).toEqual([`cms (${path.resolve(environment.settings.root, "../cms")}): the images are current (012345678)`]);
    });

    it("names the configured siblings for an unknown one", async () => {
        const { environment } = setup();

        const failure = await failureOf(runSibling({ kind: "run", name: "crm", action: "image" }, environment));

        expect(failure.exitCode).toBe(2);
        expect(failure.message).toContain('no sibling "crm" in suwgate.yml (the siblings are cms)');
    });
});
