import { describe, expect, it } from "vitest";

import { commentsHash, hashCommentsIn } from "./hash.ts";

const firstLine = (file: string, text: string) => hashCommentsIn(file, text)[0]?.line ?? 0;

describe("comments-hash", () => {
    it.each([
        ["scripts/db.sh", "#!/usr/bin/env bash\nset -euo pipefail", 0],
        ["scripts/db.sh", "#!/usr/bin/env bash\n# The local PostgreSQL\nset -euo pipefail", 2],
        ["scripts/db.sh", "set -euo pipefail\n# shellcheck disable=SC2086\necho $a", 0],
        ["scripts/db.sh", "# shellcheck source=scripts/env.sh\nsource x", 0],
        ["scripts/db.sh", "# shellcheck disable=SC2086 because\necho $a", 1],
        ["scripts/db.sh", "echo up # start it", 1],
        ["scripts/db.sh", "echo \"# not a comment\" '# nor this' ${#list[@]} $#", 0],
        [".githooks/pre-commit", "#!/usr/bin/env bash\n# Before a commit\nset -e", 2],
        ["compose.yaml", "services:\n  db:\n    image: postgres:17 # pinned", 3],
        ["compose.yaml", "name: myapp\n# the stack\nservices: {}", 2],
        [".github/workflows/ci.yml", "run: echo \"a # b\"\nname: 'c # d'", 0],
        [".github/workflows/ci.yml", "jobs:\n  gate:\n    runs-on: ubuntu-24.04 # pinned", 3],
        ["pnpm-workspace.yaml", "allowBuilds:\n  esbuild: true # its binary", 2],
        ["Myapp.Server/Dockerfile", "# syntax=docker/dockerfile:1\nFROM x:1", 0],
        ["Myapp.Server/Dockerfile", "# Build context is the repo root\nFROM x:1", 1],
        ["Myapp.Server/Dockerfile", "FROM x:1\n# syntax=docker/dockerfile:1", 2],
        ["Myapp.Server/Dockerfile", "FROM x:1\nRUN echo a # b", 0],
        [".gitignore", "**/bin/\n# generated\n**/obj/", 2],
        [".dockerignore", "node_modules\n# the context\n.git", 2],
        [".prettierignore", "dist\n# the screenshots\nvisual/snapshots", 2],
        [".gitattributes", "*.png binary\n# Line endings\n* text=auto", 2],
        [".editorconfig", "[*.cs]\n# AC-" + "notes-1\ndotnet_diagnostic.CA1000.severity = error", 0],
        [".editorconfig", "[*.cs]\n# Reason: formatting is CSharpier's job\ndotnet_diagnostic.IDE0055.severity = none", 2],
        [".editorconfig", "[*]\n; old style\nroot = true", 2],
        ["Directory.Build.rsp", "# no idle workers\n-nodeReuse:false", 1],
        ["Myapp.Web/nginx.conf.template", "server {\n    # liveness\n    listen 8080;\n}", 2],
        ["Myapp.Web/nginx.conf.template", 'add_header cache-control "public, max-age=1"; # cache', 1],
        ["justfile", "# Format the code\n[group('maintenance')]\nfmt:\n    dotnet csharpier format .", 0],
        ["justfile", "# The whole gate\ncheck *args:\n    @./check.sh", 0],
        ["justfile", "# The local stack\nmod tmux-dev", 0],
        ["justfile", '# Entry point for humans\n\nset shell := ["bash"]', 1],
        ["justfile", "# Entry point for humans\n# Format the code\nfmt:\n    x", 1],
        ["justfile", "# hidden\n[private]\ndefault:\n    @just --list", 1],
        ["justfile", "fmt:\n    # format it\n    x", 2],
        ["tmux-dev.just", '# `just tmux-dev <recipe>`\n\nset shell := ["bash"]', 1],
    ] as const)("finds the first comment of %s on line %d (0: none) (%#)", (file, text, line) => {
        expect(firstLine(file, text)).toBe(line);
    });

    it("leaves every comment of .env.example, which documents the settings", async () => {
        const findings = await commentsHash.check({
            root: "/",
            files: [".env.example", "deploy/.env.example"],
            profiles: [],
            directories: {},
            exceptions: [],
            settings: undefined,
            read: () => "# Copy to .env\n# WEB_PORT=8190",
        });

        expect(findings).toEqual([]);
    });

    it("names the file, the line and the comment, and says how to fix it", async () => {
        const findings = await commentsHash.check({
            root: "/",
            files: ["compose.yaml", "README.md", "node_modules/x/compose.yaml", "pnpm-lock.yaml"],
            profiles: [],
            directories: {},
            exceptions: [],
            settings: undefined,
            read: () => "name: myapp\n# the stack\nservices: {}",
        });

        expect(findings).toEqual([
            {
                target: "compose.yaml",
                line: 2,
                message:
                    'comment "# the stack": delete it; rename or split the code so it explains itself; put lasting knowledge in a test, the README, AGENTS.md or docs/ (the only comments allowed are the tool directives listed in AGENTS.md, "No comments")',
            },
        ]);
    });
});
