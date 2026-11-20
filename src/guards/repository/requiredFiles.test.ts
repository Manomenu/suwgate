import { describe, expect, it } from "vitest";

import type { GuardContext, Profile } from "../../gate/contract.ts";
import { EVERY_REPOSITORY, REQUIRED_BY_PROFILE, requiredFiles } from "./requiredFiles.ts";

const EVERY = Object.keys(EVERY_REPOSITORY);
const files = (profile: Profile) => Object.keys(REQUIRED_BY_PROFILE[profile]);

function context(profiles: Profile[], present: string[], extra: Partial<GuardContext> = {}): GuardContext {
    return { root: "/", files: present, profiles, directories: {}, exceptions: [], settings: undefined, read: () => "", ...extra };
}

async function missing(profiles: Profile[], present: string[], extra: Partial<GuardContext> = {}): Promise<string[]> {
    return (await requiredFiles.check(context(profiles, present, extra))).map((finding) => finding.target);
}

describe("required-files", () => {
    it("asks every repository for the files the owner named and the ones the guards read", async () => {
        expect(EVERY).toEqual(
            expect.arrayContaining([
                "suwgate.yml",
                "criteria.json",
                ".editorconfig",
                ".gitignore",
                "AGENTS.md",
                "CLAUDE.md",
                "docs/architecture.md",
                "justfile",
                ".vscode/settings.json",
                ".vscode/extensions.json",
            ]),
        );
        expect(files("dotnet")).toContain("layers.json");
        expect(await missing(["database"], [])).toEqual([...EVERY, "compose.yaml"]);
    });

    it("adds each profile's files, and only for the profiles the repository has", async () => {
        expect(await missing(["web"], EVERY)).toEqual(files("web"));
        expect(await missing(["dotnet", "database"], [...EVERY, ...files("dotnet")])).toEqual(["compose.yaml"]);
        expect(await missing(["web", "library"], [...EVERY, ...files("web")])).toEqual(["LICENSE", ".changeset/config.json"]);
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

    it("says what each missing file is for and how to fix it", async () => {
        const messages = new Map(
            (await requiredFiles.check(context(["dotnet", "database"], [], { settings: { files: ["NOTICE"] } }))).map((finding) => [
                finding.target,
                finding.message,
            ]),
        );

        expect(messages.get("compose.yaml")).toBe(
            "missing: the local PostgreSQL the server and its tests run against. The database profile needs it: add it, or add an exception with the reason it does not apply",
        );
        expect(messages.get("suwgate.yml")).toContain("the repository's gate: its profiles");
        expect(messages.get("layers.json")).toContain("which project may reference which, read by Suwgate.Architecture");
        expect(messages.get("NOTICE")).toContain("settings.required-files.files in suwgate.yml asks for it");
    });
});
