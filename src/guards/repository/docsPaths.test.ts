import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { DOTNET_GUARD_IDS, docsPaths } from "./docsPaths.ts";
import { findingsOf, shown } from "./testRepository.ts";

const FILES = {
    "src/gate/contract.ts": "",
    "src/cli.ts": "",
    "docs/architecture.md": "",
    "suwgate.yml": "",
    "schema/suwgate.schema.json": "",
    ".github/workflows/ci.yml": "",
};

const stale = async (text: string, document = "README.md", settings?: unknown) =>
    shown(await findingsOf(docsPaths, { ...FILES, [document]: text }, { settings }));

describe("docs-paths", () => {
    it.each([
        "the contract is in `src/gate/contract.ts`",
        "the CLI lives in `src/`",
        "see `ci.yml` and `workflows/ci.yml`",
        "read [the map](docs/architecture.md#the-map)",
        "`suwgate check --quick`, `@maniumek/suwgate/eslint`, `https://example.com/a.md` and `/etc/hosts.txt`",
        "a word in backticks: `profiles`",
        "local notes go in `CLAUDE.local.md`, the build in `dist/` and `dist/gate/`",
        "every `.ts` file",
        "read from `../../schema/` of the running file",
    ])("passes a mention that exists or is not a path: %s", async (text) => {
        expect(await stale(text)).toEqual([]);
    });

    it.each([
        ["the hook is `scripts/hook.sh`", ["README.md:1"]],
        ["\n\nsee [the guide](docs/guide.md)", ["README.md:3"]],
        ["`setup.md`", ["README.md:1"]],
    ])("finds a path that does not exist: %s", async (text, expected) => {
        expect(await stale(text)).toEqual(expected);
    });

    it("reads a link relative to its document", async () => {
        expect(await stale("[map](../architecture.md)", "docs/adr/README.md")).toEqual([]);
        expect(await stale("[map](../../architecture.md)", "docs/adr/README.md")).toEqual(["docs/adr/README.md:1"]);
        expect(await stale("[out](../../../suwgate.yml)", "docs/adr/README.md")).toEqual(["docs/adr/README.md:1"]);
        expect(await stale("[map](architecture.md)", "docs/README.md")).toEqual([]);
        expect(await stale("[map](../suwgate.yml)", "docs/README.md")).toEqual([]);
    });

    it("skips visual docs, changesets and changelogs, and names it was told to ignore", async () => {
        expect(await stale("`gone/file.ts`", "docs/visual/spec/a.md")).toEqual([]);
        expect(await stale("`gone/file.ts`", ".changeset/a.md")).toEqual([]);
        expect(await stale("`gone/file.ts`", "CHANGELOG.md")).toEqual([]);
        expect(await stale("`gone/file.ts`", "README.md", { ignore: ["gone/file.ts"] })).toEqual([]);
        expect(await stale("`.artifacts/nupkg`", "README.md", { ignore: [".artifacts/"] })).toEqual([]);
        expect(await stale("`.artifacts/nupkg`", "README.md", { ignore: [".artifacts"] })).toEqual(["README.md:1"]);
    });

    it("skips the documents settings.skip names by glob", async () => {
        expect(await stale("`gone/file.ts`", "docs/notes/a.md", { skip: ["docs/notes/**"] })).toEqual([]);
        expect(await stale("`gone/file.ts`", "docs/a.md", { skip: ["docs/notes/**"] })).toEqual(["docs/a.md:1"]);
    });

    it("reads a .NET guard id as a guard, not as a path", async () => {
        expect(await stale("`architecture/layers` and `database/migration-script-names`")).toEqual([]);
        expect(await stale("`architecture/layer`")).toEqual(["README.md:1"]);
    });

    it("knows every .NET guard id the packages declare", () => {
        const declared = execFileSync("git", ["grep", "-h", "-o", "-E", 'GuardId = "[a-z/-]+"', "--", "dotnet/*.cs"], { encoding: "utf8" })
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => line.replace(/^GuardId = "|"$/g, ""))
            .sort();

        expect([...DOTNET_GUARD_IDS].sort()).toEqual(declared);
    });

    it("names the document as the target and says how to fix it", async () => {
        const [finding] = await findingsOf(docsPaths, { "AGENTS.md": "`nowhere/x.ts`" });
        expect(finding).toMatchObject({ target: "AGENTS.md", line: 1 });
        expect(finding?.message).toContain("nowhere/x.ts is not a path in this repository: fix the path");
    });
});
