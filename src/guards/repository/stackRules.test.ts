import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { agentsShared, READ_SHARED_RULES, SHARED_RULES, sharedRules, sharedRulesFindings, writeSharedRules } from "./stackRules.ts";
import { findingsOf } from "./testRepository.ts";

const RULES = "# Shared rules\n\nOne rule.\n";
const AGENTS = `# AGENTS.md\n\n${READ_SHARED_RULES}\n\nOwn rule.\n`;

function findings(files: Readonly<Record<string, string>>) {
    return sharedRulesFindings(Object.keys(files), (file) => files[file] ?? "", RULES).map((finding) => finding.target);
}

describe("agents-shared", () => {
    it("passes the current copy and an AGENTS.md that points to it", () => {
        expect(findings({ [SHARED_RULES]: RULES, "AGENTS.md": AGENTS })).toEqual([]);
    });

    it("finds a missing copy and a copy edited by hand", () => {
        expect(findings({ "AGENTS.md": AGENTS })).toEqual([SHARED_RULES]);
        expect(findings({ [SHARED_RULES]: `${RULES}My own rule.\n`, "AGENTS.md": AGENTS })).toEqual([SHARED_RULES]);
    });

    it("finds an AGENTS.md that does not send agents to the shared rules", () => {
        expect(findings({ [SHARED_RULES]: RULES, "AGENTS.md": "# AGENTS.md\n\nOwn rule.\n" })).toEqual(["AGENTS.md"]);
        expect(findings({ [SHARED_RULES]: RULES, "AGENTS.md": "Read AGENTS.shared.md first.\n" })).toEqual(["AGENTS.md"]);
    });

    it("does not count the sentence inside a code block, where Claude Code does not import", () => {
        expect(findings({ [SHARED_RULES]: RULES, "AGENTS.md": `\`\`\`\n${READ_SHARED_RULES}\n\`\`\`\n` })).toEqual(["AGENTS.md"]);
    });

    it("compares the repository's copy with the one this suwgate ships", async () => {
        expect(await findingsOf(agentsShared, { [SHARED_RULES]: sharedRules(), "AGENTS.md": AGENTS })).toEqual([]);
    });

    it("writes the copy, and leaves a current one alone", () => {
        const root = mkdtempSync(path.join(tmpdir(), "agents-shared-"));
        expect(writeSharedRules(root)).toBe("written");
        expect(readFileSync(path.join(root, SHARED_RULES), "utf8")).toBe(sharedRules());
        expect(writeSharedRules(root)).toBe("current");
        writeFileSync(path.join(root, SHARED_RULES), "edited\n");
        expect(writeSharedRules(root)).toBe("written");
    });

    it("ships a shared copy that sends every reader to AGENTS.md for the rest", () => {
        expect(sharedRules()).toContain("`AGENTS.md` adds what is only its own");
    });
});
