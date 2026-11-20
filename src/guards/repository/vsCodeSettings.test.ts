import { describe, expect, it } from "vitest";

import { findingsOf } from "./testRepository.ts";
import { isStyleKey, vsCodeSettings } from "./vsCodeSettings.ts";

describe("vscode-settings", () => {
    it.each([
        ["editor.tabSize", true],
        ["files.eol", true],
        ["prettier.printWidth", true],
        ["csharpier.enableDebugLogs", true],
        ["prettier.prettierPath", false],
        ["editor.formatOnSave", false],
        ["eslint.workingDirectories", false],
    ])("knows a style key: %s", (key, expected) => {
        expect(isStyleKey(key)).toBe(expected);
    });

    it("finds style rules, also inside a language block", async () => {
        const settings = JSON.stringify({ "editor.formatOnSave": true, "[typescript]": { "editor.tabSize": 2 }, "files.eol": "\n" });
        const findings = await findingsOf(vsCodeSettings, { ".vscode/settings.json": settings });

        expect(findings.map((finding) => finding.message.split(" ")[0])).toEqual(["editor.tabSize", "files.eol"]);
        expect(findings[0]?.message).toContain("move it to .editorconfig");
    });

    it("finds a malformed or repeated extension id", async () => {
        const extensions = JSON.stringify({
            recommendations: ["esbenp.prettier-vscode", "Dbaeumer.ESLint", "esbenp.prettier-vscode", "just"],
        });
        const findings = await findingsOf(vsCodeSettings, { ".vscode/extensions.json": extensions });

        expect(findings.map((finding) => finding.message.split(":")[0])).toEqual([
            '"Dbaeumer.ESLint"',
            '"esbenp.prettier-vscode"',
            '"just"',
        ]);
    });

    it("asks for JSON every tool can read, and leaves a missing file alone", async () => {
        expect((await findingsOf(vsCodeSettings, { ".vscode/settings.json": '{ "a": 1, }' }))[0]?.message).toContain("not valid JSON");
        expect(await findingsOf(vsCodeSettings, {})).toEqual([]);
    });
});
