import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_MAP_LINE_LENGTH, repositoryLayout } from "./repositoryLayout.ts";
import { findingsOf, gitRepository, shown } from "./testRepository.ts";

const MAP = ["# Architecture", "", "- `src/` — the code", "- `docs/` — the docs", "", "Files at the root: `README.md`."].join("\n");
const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("repository-layout", () => {
    it("passes when the map names every top-level folder and nothing else", async () => {
        expect(await findingsOf(repositoryLayout, { "docs/architecture.md": MAP, "src/a.ts": "", "README.md": "" })).toEqual([]);
    });

    it("finds a folder missing from the map and a map line for a folder that is gone", async () => {
        const map = `${MAP}\n- \`scripts/\` — gone`;
        const findings = await findingsOf(repositoryLayout, {
            "docs/architecture.md": map,
            "src/a.ts": "",
            ".github/workflows/ci.yml": "",
        });

        expect(shown(findings)).toEqual([".github/", "docs/architecture.md:7"]);
        expect(findings[0]?.message).toContain("- `.github/` — what it holds");
    });

    it("keeps every line of the map short", async () => {
        const map = `- \`src/\` — ${"x".repeat(MAX_MAP_LINE_LENGTH)}\n- \`docs/\` — the docs`;
        expect(shown(await findingsOf(repositoryLayout, { "docs/architecture.md": map, "src/a.ts": "" }))).toEqual([
            "docs/architecture.md:1",
        ]);
    });

    it("finds two files that differ only in letter case", async () => {
        expect(shown(await findingsOf(repositoryLayout, { "readme.md": "", "README.md": "" }))).toEqual(["README.md"]);
    });

    it("finds a shell script or git hook that git does not mark executable", async () => {
        const root = gitRepository(
            { "scripts/run.sh": "#!/bin/sh\n", "scripts/plain.sh": "#!/bin/sh\n", ".githooks/pre-commit": "#!/bin/sh\n", "a.txt": "" },
            ["scripts/run.sh"],
        );
        roots.push(root);

        const findings = await repositoryLayout.check({
            root,
            files: ["a.txt"],
            profiles: ["web"],
            directories: {},
            exceptions: [],
            settings: undefined,
            read: () => "",
        });

        expect(shown(findings)).toEqual([".githooks/pre-commit", "scripts/plain.sh"]);
        expect(findings[0]?.message).toBe("not executable in git: run git update-index --chmod=+x .githooks/pre-commit");
    });
});
