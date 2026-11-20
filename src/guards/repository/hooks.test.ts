import { describe, expect, it } from "vitest";

import { hooks, matcherCovers } from "./hooks.ts";
import { findingsOf } from "./testRepository.ts";

const wired = (stop: string, edit: string, matcher = "Edit|Write") =>
    JSON.stringify({
        hooks: {
            Stop: [{ hooks: [{ type: "command", command: stop, timeout: 600 }] }],
            PreToolUse: [{ matcher, hooks: [{ type: "command", command: edit }] }],
        },
    });

describe("hooks", () => {
    it.each([
        ["Edit|Write", "Edit", true],
        ["Edit,Write", "Write", true],
        ["*", "Write", true],
        ["", "Edit", true],
        ["Edit.*", "Edit", true],
        ["^(Edit|Write)$", "Write", true],
        ["MultiEdit", "Edit", false],
        ["Write", "Edit", false],
    ])("reads a matcher as Claude Code does: %s covers %s", (matcher, tool, expected) => {
        expect(matcherCovers(matcher, tool)).toBe(expected);
    });

    it("passes the wiring of any launcher of suwgate", async () => {
        const files = {
            ".claude/settings.json": wired(
                'node "${CLAUDE_PROJECT_DIR}/src/cli.ts" hook stop',
                '"${CLAUDE_PROJECT_DIR}/node_modules/.bin/suwgate" hook guard-edit',
                "Edit|Write|MultiEdit|NotebookEdit",
            ),
            ".githooks/pre-commit": '#!/usr/bin/env bash\nexec node_modules/.bin/suwgate hook pre-commit "$@"\n',
        };
        expect(await findingsOf(hooks, files)).toEqual([]);
    });

    it("finds a missing Stop hook, an edit hook that misses a tool, and a pre-commit that does not call suwgate", async () => {
        const files = {
            ".claude/settings.json": wired("bash scripts/hook-stop.sh", "suwgate hook guard-edit", "Edit"),
            ".githooks/pre-commit": "#!/usr/bin/env bash\ngitleaks git --staged\n",
        };
        const messages = (await findingsOf(hooks, files)).map((finding) => `${finding.target}: ${finding.message.split(",")[0] ?? ""}`);

        expect(messages).toEqual([
            ".claude/settings.json: no Stop hook runs suwgate hook stop",
            ".claude/settings.json: no PreToolUse hook runs suwgate hook guard-edit for Write",
            ".githooks/pre-commit: it does not run suwgate hook pre-commit (gitleaks on the staged changes",
        ]);
    });

    it("says what to add, and leaves missing files to required-files", async () => {
        const [finding] = await findingsOf(hooks, { ".claude/settings.json": "{}" });
        expect(finding?.message).toContain('"command": "<suwgate> hook stop"');
        expect(await findingsOf(hooks, {})).toEqual([]);
    });
});
