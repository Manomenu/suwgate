import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { guardEdit, type EditHookSettings } from "./guardEdit.ts";

const PROJECT = "/work/app";
const EVERY_PROFILE = ["web", "library", "dotnet", "database"];

function edit(file: string, options: { allowGateEdit?: boolean; profiles?: string[]; settings?: EditHookSettings; root?: string } = {}) {
    const root = options.root ?? PROJECT;
    return guardEdit(
        JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file.startsWith("/") ? file : `${root}/${file}` } }),
        { root, profiles: options.profiles ?? EVERY_PROFILE, settings: options.settings ?? {} },
        options.allowGateEdit ?? false,
    );
}

const temporary: string[] = [];

afterEach(() => {
    for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repositoryWith(files: string[]): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-hook-"));
    temporary.push(root);
    for (const file of files) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), "");
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    return root;
}

describe("the edit hook", () => {
    it.each([
        "suwgate.yml",
        "criteria.json",
        ".claude/settings.json",
        ".github/workflows/ci.yml",
        ".githooks/pre-commit",
        ".editorconfig",
        "Myapp.Web/.editorconfig",
    ])("refuses an agent's edit of %s in every repository and sends it to the owner", (file) => {
        const verdict = edit(file, { profiles: ["database"] });

        expect(verdict.exitCode).toBe(2);
        expect(verdict.message).toContain("ALLOW_GATE_EDIT=1 claude");
        expect(verdict.message).toContain("ask the user");
    });

    it.each([
        ["web", "Myapp.Web/eslint.config.js"],
        ["web", "Myapp.Web/tsconfig.app.json"],
        ["web", "Myapp.Web/playwright.config.ts"],
        ["library", "knip.json"],
        ["library", "vitest.config.ts"],
        ["library", ".changeset/config.json"],
        ["library", ".storybook/main.ts"],
        ["dotnet", "Directory.Build.props"],
        ["dotnet", "BannedSymbols.txt"],
        ["dotnet", "Myapp.Gate/layers.json"],
    ])("refuses the gate files of the %s profile: %s", (profile, file) => {
        expect(edit(file, { profiles: [profile] }).exitCode).toBe(2);
        expect(edit(file, { profiles: ["database"] }).exitCode).toBe(0);
    });

    it("lets the owner's session edit the gate", () => {
        expect(edit("suwgate.yml", { allowGateEdit: true }).exitCode).toBe(0);
        expect(edit("Directory.Build.props", { allowGateEdit: true }).exitCode).toBe(0);
    });

    it.each([
        ["pnpm-lock.yaml", "pnpm install"],
        ["Myapp.Web/pnpm-lock.yaml", "pnpm install"],
        ["dotnet/Suwgate.Tests/packages.lock.json", "dotnet restore"],
        ["Myapp.Web/src/api/openapi.d.ts", "API types"],
        ["contract/openapi.json", "API contract"],
    ])("refuses the generated %s with the command that regenerates it, even in the owner's session", (file, command) => {
        const verdict = edit(file, { allowGateEdit: true });

        expect(verdict.exitCode).toBe(2);
        expect(verdict.message).toContain(command);
    });

    it("takes the repository's own gate files and generated files from its settings", () => {
        const settings = {
            protected: ["visual/*.visual.ts", "gate/**"],
            generated: [
                { path: "src/theme/palette.css", command: "just palette" },
                { path: "visual/snapshots/**", command: "gate/scripts/visual.sh --update" },
            ],
        };

        expect(edit("visual/stories.visual.ts", { settings }).exitCode).toBe(2);
        expect(edit("gate/consumer/app.tsx", { settings }).exitCode).toBe(2);
        expect(edit("src/theme/palette.css", { settings, allowGateEdit: true }).message).toContain("just palette");
        expect(edit("visual/snapshots/1920x1080/button--variants.png", { settings }).message).toContain("visual.sh --update");
        expect(edit("src/theme/theme.css", { settings }).exitCode).toBe(0);
    });

    it("refuses a recorded characterization test git tracks, and lets a new one be written", () => {
        const root = repositoryWith(["Myapp.Server.Tests/Characterization/NotesRecorded.cs"]);

        const verdict = edit("Myapp.Server.Tests/Characterization/NotesRecorded.cs", { root, profiles: ["dotnet"] });
        expect(verdict.exitCode).toBe(2);
        expect(verdict.message).toContain("ALLOW_GATE_EDIT=1 claude");
        expect(edit("Myapp.Server.Tests/Characterization/New.cs", { root, profiles: ["dotnet"] }).exitCode).toBe(0);
        expect(
            edit("Myapp.Server.Tests/Characterization/NotesRecorded.cs", { root, profiles: ["dotnet"], allowGateEdit: true }).exitCode,
        ).toBe(0);
        expect(
            edit("Myapp.Server.Tests/Golden/Report.txt", { root, profiles: ["dotnet"], settings: { recordings: ["**/Golden/**"] } })
                .exitCode,
        ).toBe(0);
    });

    it("refuses an existing migration even in the owner's session, and lets the next one be added", () => {
        const root = repositoryWith(["Myapp.Server/Database/Migrations/up/0001_notes.sql", "db/0001_first.sql"]);

        const verdict = edit("Myapp.Server/Database/Migrations/up/0001_notes.sql", { root, profiles: ["database"], allowGateEdit: true });
        expect(verdict.exitCode).toBe(2);
        expect(verdict.message).toContain("next free number");
        expect(edit("Myapp.Server/Database/Migrations/up/0002_tags.sql", { root, profiles: ["database"] }).exitCode).toBe(0);
        expect(edit("db/0001_first.sql", { root, profiles: ["database"], settings: { migrations: ["db/*.sql"] } }).exitCode).toBe(2);
    });

    it.each(["src/gate/config.ts", "README.md", "AGENTS.md", "docs/suwgate.yml.md", "package.json", "Myapp.Server/Notes/NoteStore.cs"])(
        "leaves %s editable",
        (file) => {
            expect(edit(file).exitCode).toBe(0);
        },
    );

    it.each([
        "/elsewhere/other-repo/suwgate.yml",
        "/elsewhere/other-repo/Web/eslint.config.js",
        "/elsewhere/other-repo/Web/tsconfig.json",
        "/elsewhere/other-repo/.claude/settings.json",
        "/elsewhere/other-repo/Web/pnpm-lock.yaml",
        "/work/app-two/suwgate.yml",
        "/work/app/../app-two/Directory.Build.props",
    ])("guards only its own project: %s belongs to another one and stays editable", (file) => {
        expect(edit(file).exitCode).toBe(0);
    });

    it("reads Windows paths and ignores input it cannot read", () => {
        const windows = JSON.stringify({ tool_input: { file_path: "C:\\work\\app\\suwgate.yml" } });

        expect(guardEdit(windows, { root: "C:\\work\\app", profiles: [], settings: {} }, false).exitCode).toBe(2);
        expect(guardEdit(windows, { root: "C:\\work\\other", profiles: [], settings: {} }, false).exitCode).toBe(0);
        expect(guardEdit("not json", { root: PROJECT, profiles: [], settings: {} }, false).exitCode).toBe(0);
    });
});
