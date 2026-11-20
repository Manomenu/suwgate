import { describe, expect, it } from "vitest";

import { humanDocs } from "./humanDocs.ts";
import { findingsOf, shown } from "./testRepository.ts";

const SCRIPTS = {
    "scripts/.internal/db.sh": "",
    "scripts/.internal/init-project.proj": "",
    "Myapp.Gate/scripts/gate.sh": "",
    justfile:
        'set shell := ["bash", "-c"]\n\nmod db\n\ngate := "Myapp.Gate/scripts/gate.sh"\n\n# The gate\ncheck *args:\n    {{ gate }} check {{ args }}\n',
    "db.just": "# Start the database\nup:\n    scripts/.internal/db.sh up\n",
};

const stale = async (text: string, document = "README.md", extra = {}) =>
    shown(await findingsOf(humanDocs, { ...SCRIPTS, [document]: text }, extra));

describe("human-docs", () => {
    it.each([
        "run `scripts/.internal/db.sh up` to start the database",
        "start it with `bash scripts/.internal/db.sh up`",
        "`gate.sh check --verbose` lists every step",
        "`just check` and `gate.sh check --verbose` print the report",
        "Without it, run `dotnet msbuild scripts/.internal/init-project.proj` yourself.",
        "```sh\nscripts/.internal/db.sh\n```",
        "```\n./scripts/.internal/db.sh up\n```",
    ])("finds a doc for people that tells them to run a script for agents: %s", async (text) => {
        expect(await stale(text)).toHaveLength(1);
    });

    it.each([
        "run `just db up` to start the database",
        "the scripts in `scripts/.internal/` are bash",
        "the post action runs `scripts/.internal/init-project.proj` once",
        "`just check` (`suwgate check` through `Myapp.Gate/scripts/gate.sh`)",
        "`just check` runs the gate (`Myapp.Gate/scripts/gate.sh check [--quick]`)",
        "the Stop hook runs `gate.sh hook stop`, and the gate starts the database through `scripts/.internal/db.sh up`",
        "```yaml\nsteps:\n  add:\n    - run: scripts/.internal/db.sh\n```",
        "the agents' scripts live in scripts/.internal/ and answer --help",
    ])("passes a recipe, and a script named to explain what runs it: %s", async (text) => {
        expect(await stale(text)).toEqual([]);
    });

    it("reads README.md, docs/development.md and the README of a profile's directory, not the other docs", async () => {
        const command = "\n`scripts/.internal/db.sh up`";

        expect(await stale(command, "docs/development.md")).toEqual(["docs/development.md:2"]);
        expect(await stale(command, "Myapp.Web/README.md", { profiles: ["web"], directories: { web: "Myapp.Web" } })).toEqual([
            "Myapp.Web/README.md:2",
        ]);
        expect(await stale(command, "docs/adr/README.md")).toEqual([]);
        expect(await stale(command, "AGENTS.md")).toEqual([]);
    });

    it("names the recipe that calls the script, a module's recipe with its module", async () => {
        const [db] = await findingsOf(humanDocs, { ...SCRIPTS, "README.md": "`scripts/.internal/db.sh up`" });
        const [gate] = await findingsOf(humanDocs, { ...SCRIPTS, "README.md": "`gate.sh check --verbose`" });

        expect(db?.message).toBe(
            "a person runs a just recipe, never scripts/.internal/db.sh, a script for agents: name `just db up` instead (a doc may still name it to explain what runs it: in parentheses or after runs, calls or starts)",
        );
        expect(gate?.message).toContain("never gate.sh, a script for agents: name `just check` instead");
    });

    it("asks for a recipe when none calls the script", async () => {
        const [finding] = await findingsOf(humanDocs, {
            ...SCRIPTS,
            "README.md": "run `dotnet msbuild scripts/.internal/init-project.proj` yourself",
        });

        expect(finding?.message).toBe(
            "a person runs a just recipe, never scripts/.internal/init-project.proj, a script for agents: add a recipe that calls it to the justfile and name the recipe here (a doc may still name it to explain what runs it: in parentheses or after runs, calls or starts)",
        );
    });
});
