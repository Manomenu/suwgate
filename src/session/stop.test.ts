import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stop } from "./stop.ts";

let root = "";

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "suwgate-stop-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(path.join(root, "a.txt"), "one");
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("the stop hook", () => {
    it("blocks the agent with the tail of a red quick gate", async () => {
        const verdict = await stop("{}", root, () => Promise.resolve({ exitCode: 1, text: "FAIL lint" }));

        expect(verdict).toEqual({
            exitCode: 2,
            message: "The quick gate (suwgate check --quick) is red. Fix it before finishing:\nFAIL lint",
        });
    });

    it("runs the quick gate again only after something changed since it last passed", async () => {
        let runs = 0;
        const green = () => {
            runs++;
            return Promise.resolve({ exitCode: 0, text: "PASS" });
        };

        await stop("{}", root, green);
        await stop("{}", root, green);
        writeFileSync(path.join(root, "a.txt"), "two");
        await stop("{}", root, green);

        expect(runs).toBe(2);
    });

    it("lets the agent stop when it is already continuing because of this hook", async () => {
        const verdict = await stop('{"stop_hook_active": true}', root, () => Promise.resolve({ exitCode: 1, text: "FAIL" }));

        expect(verdict.exitCode).toBe(0);
    });
});
