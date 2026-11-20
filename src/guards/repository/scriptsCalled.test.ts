import { describe, expect, it } from "vitest";

import { isScript, scriptsCalled } from "./scriptsCalled.ts";
import { findingsOf, shown } from "./testRepository.ts";

describe("scripts-called", () => {
    it.each([
        ["scripts/db.sh", true],
        ["Myapp.Server/entrypoint.sh", true],
        ["scripts/.internal/palette.ts", true],
        ["gate/scripts/check.ts", true],
        ["scripts/README.md", false],
        ["src/scripts.ts", false],
    ])("knows a script: %s", (file, expected) => {
        expect(isScript(file)).toBe(expected);
    });

    it.each([
        ["justfile", "db:\n    scripts/db.sh up\n"],
        ["tools/mod.just", "db:\n    scripts/db.sh\n"],
        ["scripts/dev.sh", "./db.sh up\n"],
        [".githooks/pre-commit", "scripts/db.sh\n"],
        [".github/workflows/ci.yml", "run: scripts/db.sh\n"],
        [".claude/settings.json", '{"command": "bash scripts/db.sh"}'],
        ["Myapp.Web/package.json", '{"scripts": {"db": "../scripts/db.sh"}}'],
        ["suwgate.yml", "steps:\n  add:\n    - name: db\n      run: scripts/db.sh\n"],
        ["compose.yaml", "entrypoint: /app/db.sh\n"],
        ["suwgate.yml", "steps:\n  configure:\n    e2e:\n      settings:\n        before: [scripts/db.sh seed]\n"],
        ["suwgate.yml", "dev:\n  name: app\n  database:\n    up: scripts/db.sh up\n"],
        ["claude-plugin/hooks/hooks.json", '{"hooks": {"SessionStart": [{"hooks": [{"command": "sh scripts/db.sh"}]}]}}'],
    ])("lets a script through that %s calls", async (caller, text) => {
        expect(shown(await findingsOf(scriptsCalled, { "scripts/db.sh": "", [caller]: text }))).not.toContain("scripts/db.sh");
    });

    it("does not count a script that suwgate.yml names only in an exception or a reason", async () => {
        const config = [
            "steps:",
            "  skip:",
            "    - step: e2e",
            "      reason: scripts/db.sh prepares it",
            "exceptions:",
            "  - guard: scripts-called",
            "    target: scripts/db.sh",
            "    reason: called by hand",
        ].join("\n");

        expect(shown(await findingsOf(scriptsCalled, { "scripts/db.sh": "", "suwgate.yml": config }))).toEqual(["scripts/db.sh"]);
    });

    it("finds a script nothing calls, also one that only names itself", async () => {
        const findings = await findingsOf(scriptsCalled, {
            "scripts/db.sh": "usage: db.sh up\n",
            "scripts/.internal/old.ts": "",
            "README.md": "run scripts/db.sh",
        });

        expect(shown(findings)).toEqual(["scripts/db.sh", "scripts/.internal/old.ts"]);
        expect(findings[0]?.message).toContain("nothing calls it: delete it");
    });
});
