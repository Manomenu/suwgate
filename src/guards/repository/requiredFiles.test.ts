import { describe, expect, it } from "vitest";

import type { GuardContext, Profile } from "../../gate/contract.ts";
import { REQUIRED_BY_PROFILE, requiredFiles } from "./requiredFiles.ts";

const EVERY = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    ".claude/settings.json",
    ".githooks/pre-commit",
    "justfile",
    "docs/architecture.md",
    "docs/development.md",
];

function context(profiles: Profile[], files: string[], extra: Partial<GuardContext> = {}): GuardContext {
    return { root: "/", files, profiles, directories: {}, exceptions: [], settings: undefined, read: () => "", ...extra };
}

async function missing(profiles: Profile[], files: string[], extra: Partial<GuardContext> = {}): Promise<string[]> {
    return (await requiredFiles.check(context(profiles, files, extra))).map((finding) => finding.target);
}

describe("required-files", () => {
    it("asks every repository for the agent rules, the editor and git settings, the hooks and the docs", async () => {
        expect(await missing(["database"], [])).toEqual([...EVERY, "compose.yaml"]);
    });

    it("adds each profile's files, and only for the profiles the repository has", async () => {
        expect(await missing(["web"], EVERY)).toEqual([...REQUIRED_BY_PROFILE.web]);
        expect(await missing(["dotnet", "database"], [...EVERY, ...REQUIRED_BY_PROFILE.dotnet])).toEqual(["compose.yaml"]);
        expect(await missing(["web", "library"], [...EVERY, ...REQUIRED_BY_PROFILE.web])).toEqual(["LICENSE", ".changeset/config.json"]);
    });

    it("looks for a profile's files in its directory", async () => {
        expect(await missing(["web"], [...EVERY, "Myapp.Web/package.json"], { directories: { web: "Myapp.Web" } })).not.toContain(
            "Myapp.Web/package.json",
        );
        expect(await missing(["web"], EVERY, { directories: { web: "Myapp.Web" } })).toContain("Myapp.Web/eslint.config.js");
    });

    it("takes more files from its settings", async () => {
        expect(await missing(["database"], [...EVERY, "compose.yaml"], { settings: { files: ["NOTICE"] } })).toEqual(["NOTICE"]);
    });

    it("says how to fix each missing file", async () => {
        const [finding] = await requiredFiles.check(context(["database"], EVERY));
        expect(finding?.message).toBe(
            "missing: add compose.yaml (its profile needs it), or add an exception with the reason it does not apply",
        );
    });
});
