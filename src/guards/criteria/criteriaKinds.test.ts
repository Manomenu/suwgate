import { describe, expect, it } from "vitest";

import type { GuardContext } from "../../gate/contract.ts";
import { criteriaKinds } from "./criteriaKinds.ts";

function context(files: Record<string, string>): GuardContext {
    return {
        root: "/",
        files: Object.keys(files),
        profiles: ["web"],
        directories: {},
        exceptions: [],
        settings: undefined,
        read: (file) => files[file] ?? "",
    };
}

const CRITERIA = JSON.stringify({ kinds: [{ kind: "smoke test", paths: ["scripts/smoke.sh"], how: "# <id>" }] });

async function findings(files: Record<string, string>) {
    return await criteriaKinds.check(context(files));
}

describe("criteria-kinds", () => {
    it("asks nothing of a repository that uses only the default kinds of its profiles", async () => {
        expect(await findings({ "README.md": "# app" })).toEqual([]);
        expect(await findings({ "criteria.json": '{ "specs": "specs" }' })).toEqual([]);
    });

    it.each([
        ["README.md", "| `smoke test` | `scripts/smoke.sh` | `# <id>` |"],
        ["docs/development.md", "|  `smoke test`   |  where | how |"],
    ])("passes a kind of criteria.json that %s explains in a table row", async (document, row) => {
        expect(await findings({ "criteria.json": CRITERIA, [document]: `| Kind | Where | How |\n| :-- | :-- | :-- |\n${row}\n` })).toEqual(
            [],
        );
    });

    it.each([
        ["no document", {}],
        ["a mention outside a table", { "README.md": "the smoke test runs scripts/smoke.sh" }],
        ["a row in another file", { "docs/architecture.md": "| `smoke test` | x | y |" }],
    ])("fails a kind with %s, saying where to add its row", async (_, documents: Record<string, string>) => {
        expect(await findings({ "criteria.json": CRITERIA, ...documents })).toEqual([
            {
                target: "smoke test",
                message:
                    "no row explains this kind of guardrail of criteria.json: add `| `smoke test` | where | how it names the id |` to a table of README.md or docs/development.md",
            },
        ]);
    });

    it.each(["{", '{ "kinds": {} }'])("fails a criteria.json that is not a list of kinds: %s", async (text) => {
        const [finding] = await findings({ "criteria.json": text });

        expect(finding?.target).toBe("criteria.json");
        expect(finding?.message).toContain('write { "kinds": [');
    });

    it("fails a kind without a name", async () => {
        expect((await findings({ "criteria.json": '{ "kinds": [{ "paths": [] }] }' }))[0]?.message).toBe(
            'a kind without a name: give each kind of criteria.json its "kind"',
        );
    });
});
