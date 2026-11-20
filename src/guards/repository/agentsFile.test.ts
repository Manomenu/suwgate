import { describe, expect, it } from "vitest";

import { agentsFile, MAX_AGENTS_LINES } from "./agentsFile.ts";
import { findingsOf, shown } from "./testRepository.ts";

const rules = (text: string, settings?: unknown) =>
    findingsOf(agentsFile, { "AGENTS.md": text, "CLAUDE.md": "@AGENTS.md\n" }, { settings });

describe("agents-file", () => {
    it("passes short plain rules and a CLAUDE.md that points to them", async () => {
        expect(await rules("# AGENTS.md\n\nKISS and YAGNI first. Run the gate before calling a change done.\n")).toEqual([]);
    });

    it("counts the lines of AGENTS.md against the limit", async () => {
        expect(await rules("rule\n".repeat(MAX_AGENTS_LINES))).toEqual([]);
        const [finding] = await rules("rule\n".repeat(MAX_AGENTS_LINES + 1));
        expect(finding?.message).toContain(`${MAX_AGENTS_LINES + 1} lines, the limit is ${MAX_AGENTS_LINES}`);
    });

    it("finds a directory tree", async () => {
        expect(shown(await rules("# Layout\n├── src\n└── docs\n"))).toEqual(["AGENTS.md:2", "AGENTS.md:3"]);
    });

    it.each([
        ["NEVER edit the gate", ["AGENTS.md:1"]],
        ["Read README and TODO, run the JSON check", []],
        ["the CLI and the SDK", []],
    ])("judges shouting by words of four capitals or more: %s", async (line, expected) => {
        expect(shown(await rules(`${line}\n`))).toEqual(expected);
    });

    it("takes more acronyms from its settings and says where to add one", async () => {
        expect(await rules("Use NUGET.\n", { acronyms: ["NUGET"] })).toEqual([]);
        const [finding] = await rules("Use NUGET.\n");
        expect(finding?.message).toContain("settings.agents-file.acronyms");
    });

    it("refuses a CLAUDE.md with its own rules", async () => {
        const findings = await findingsOf(agentsFile, { "AGENTS.md": "rules\n", "CLAUDE.md": "@AGENTS.md\nAlso commit often.\n" });
        expect(findings).toEqual([{ target: "CLAUDE.md", message: expect.stringContaining("exactly @AGENTS.md") as string }]);
    });

    it("leaves a missing file to required-files", async () => {
        expect(await findingsOf(agentsFile, {})).toEqual([]);
    });
});
