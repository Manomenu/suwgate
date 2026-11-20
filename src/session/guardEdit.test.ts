import { describe, expect, it } from "vitest";

import { guardEdit } from "./guardEdit.ts";

const PROJECT = "/work/app";
const edit = (file: string, allowGateEdit = false) =>
    guardEdit(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } }), PROJECT, allowGateEdit);

describe("the edit hook", () => {
    it.each([
        "suwgate.yml",
        ".claude/settings.json",
        ".github/workflows/ci.yml",
        ".githooks/pre-commit",
        ".editorconfig",
        "eslint.config.js",
        "Myapp.Web/eslint.config.js",
        "Myapp.Web/tsconfig.app.json",
        "Directory.Build.props",
        "BannedSymbols.txt",
        "knip.json",
    ])("refuses an agent's edit of %s and sends it to the owner", (file) => {
        const verdict = edit(`${PROJECT}/${file}`);

        expect(verdict.exitCode).toBe(2);
        expect(verdict.message).toContain("ALLOW_GATE_EDIT=1 claude");
        expect(verdict.message).toContain("ask the user");
    });

    it("lets the owner's session edit the gate", () => {
        expect(edit(`${PROJECT}/suwgate.yml`, true).exitCode).toBe(0);
    });

    it.each([
        ["pnpm-lock.yaml", "pnpm install"],
        ["dotnet/Suwgate.Tests/packages.lock.json", "dotnet restore"],
    ])("refuses the generated %s with the command that regenerates it", (file, command) => {
        const verdict = edit(`${PROJECT}/${file}`, true);

        expect(verdict.exitCode).toBe(2);
        expect(verdict.message).toContain(command);
    });

    it.each([
        "src/gate/config.ts",
        "README.md",
        "docs/suwgate.yml.md",
        "package.json",
        "/elsewhere/other/suwgate.yml",
        "/work/app-two/suwgate.yml",
    ])("leaves %s editable", (file) => {
        expect(edit(file.startsWith("/") ? file : `${PROJECT}/${file}`).exitCode).toBe(0);
    });

    it("reads Windows paths and ignores input it cannot read", () => {
        expect(
            guardEdit(JSON.stringify({ tool_input: { file_path: "C:\\work\\app\\suwgate.yml" } }), "C:\\work\\app", false).exitCode,
        ).toBe(2);
        expect(guardEdit("not json", PROJECT, false).exitCode).toBe(0);
    });
});
