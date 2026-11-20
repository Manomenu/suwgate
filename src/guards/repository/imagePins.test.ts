import { describe, expect, it } from "vitest";

import { imagePins, isPinned } from "./imagePins.ts";
import { findingsOf, shown } from "./testRepository.ts";

describe("image-pins", () => {
    it.each([
        ["postgres:17.2", true],
        ["ghcr.io/owner/app:1.4.0", true],
        ["localhost:5000/app:2", true],
        ["node@sha256:0123abcd", true],
        ["postgres", false],
        ["postgres:latest", false],
        ["localhost:5000/app", false],
    ])("judges %s", (image, expected) => {
        expect(isPinned(image)).toBe(expected);
    });

    it("reads Dockerfiles, YAML files and scripts, and skips build stages, scratch and variables", async () => {
        const files = {
            "Myapp.Server/Dockerfile": [
                "FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build",
                "FROM build AS publish",
                "FROM scratch AS empty",
                "FROM ${BASE}",
                "FROM mcr.microsoft.com/dotnet/aspnet",
            ].join("\n"),
            "compose.yaml": "services:\n  db:\n    image: postgres:latest\n  cache:\n    image: 'valkey/valkey:8.1'\n",
            ".github/workflows/ci.yml": "    services:\n      - image: redis\n",
            "scripts/visual.sh": 'IMAGE="mcr.microsoft.com/playwright"\n',
            "pnpm-lock.yaml": "image: anything\n",
        };

        expect(shown(await findingsOf(imagePins, files))).toEqual([
            "Myapp.Server/Dockerfile:5",
            "compose.yaml:3",
            ".github/workflows/ci.yml:2",
            "scripts/visual.sh:1",
        ]);
    });

    it("says how to pin it", async () => {
        const [finding] = await findingsOf(imagePins, { "compose.yaml": "image: postgres\n" });
        expect(finding?.message).toContain("postgres moves with every release");
    });

    it("keeps the Playwright image at the installed @playwright/test", async () => {
        const script = 'IMAGE="mcr.microsoft.com/playwright:v1.50.0-noble"\n';
        const manifest = (version: string) => JSON.stringify({ devDependencies: { "@playwright/test": version } });

        expect(await findingsOf(imagePins, { "scripts/visual.sh": script, "package.json": manifest("1.50.0") })).toEqual([]);
        expect(await findingsOf(imagePins, { "scripts/visual.sh": script })).toEqual([]);
        const [finding] = await findingsOf(imagePins, { "scripts/visual.sh": script, "web/package.json": manifest("^1.51.1") });
        expect(finding?.message).toContain("move it to mcr.microsoft.com/playwright:v1.51.1-noble");
    });
});
