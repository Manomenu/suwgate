import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "../cli.ts");
let parent = "";
let project = "";
let other = "";

function checkout(name: string, profiles: string): string {
    const root = path.join(parent, name);
    mkdirSync(path.join(root, "web"), { recursive: true });
    writeFileSync(path.join(root, "suwgate.yml"), `profiles: [${profiles}]\n`);
    execFileSync("git", ["init", "-q"], { cwd: root });
    return root;
}

function hook(file: string, options: { cwd: string; projectDir?: string }): number | null {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env["CLAUDE_PROJECT_DIR"];
    delete env["ALLOW_GATE_EDIT"];
    if (options.projectDir !== undefined) env["CLAUDE_PROJECT_DIR"] = options.projectDir;
    return spawnSync(process.execPath, [CLI, "hook", "guard-edit"], {
        cwd: options.cwd,
        env,
        input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } }),
    }).status;
}

beforeAll(() => {
    parent = mkdtempSync(path.join(tmpdir(), "suwgate-hook-command-"));
    project = checkout("app", "web");
    other = checkout("app-two", "web, dotnet");
});

afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
});

describe("suwgate hook guard-edit", () => {
    it("guards the files of the project Claude Code names, with that project's profiles", () => {
        expect(hook(path.join(project, "suwgate.yml"), { cwd: project, projectDir: project })).toBe(2);
        expect(hook(path.join(project, "web/eslint.config.js"), { cwd: project, projectDir: project })).toBe(2);
        expect(hook(path.join(project, "Directory.Build.props"), { cwd: project, projectDir: project })).toBe(0);
    });

    it("leaves another project's gate files editable", () => {
        for (const file of ["suwgate.yml", "web/eslint.config.js", "web/tsconfig.json", ".claude/settings.json", "Directory.Build.props"]) {
            expect(hook(path.join(other, file), { cwd: project, projectDir: project })).toBe(0);
        }
    });

    it("takes the checkout it runs in when Claude Code names no project", () => {
        expect(hook(path.join(project, "suwgate.yml"), { cwd: path.join(project, "web") })).toBe(2);
        expect(hook(path.join(other, "suwgate.yml"), { cwd: project })).toBe(0);
    });
});
