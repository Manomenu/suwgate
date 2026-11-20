import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as prettierApi from "prettier";
import { afterEach, describe, expect, it } from "vitest";

import { knip } from "./knip.ts";
import { e2eTests, visualTests } from "./playwright.ts";
import prettier from "./prettier.ts";
import { storyTests, unitTests } from "./vitest.ts";

const PRESETS = import.meta.dirname;

const folders: string[] = [];

function folder(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-presets-"));
    folders.push(root);
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    return root;
}

afterEach(() => {
    for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true });
});

describe("the tsconfig presets", () => {
    it.each(["browser", "node"])("give the %s preset every strict option", (preset) => {
        const app = folder({
            "tsconfig.json": JSON.stringify({ extends: path.join(PRESETS, "tsconfig", `${preset}.json`), compilerOptions: { types: [] } }),
            "src/a.ts": "export const a = 1;",
        });
        const shown = JSON.parse(
            execFileSync(path.join(import.meta.dirname, "../../../node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--showConfig"], {
                cwd: app,
                encoding: "utf8",
            }),
        ) as { compilerOptions: Record<string, unknown> };

        expect(shown.compilerOptions).toMatchObject({ strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true });
        expect(shown.compilerOptions["lib"]).toEqual(preset === "browser" ? ["es2022", "dom", "dom.iterable"] : ["es2022", "dom"]);
    });
});

describe("the Prettier preset", () => {
    it("is what a .prettierrc.json naming it resolves to", async () => {
        const app = folder({ ".prettierrc.json": JSON.stringify(path.join(PRESETS, "prettier.ts")), "a.yaml": "a: 1\n" });

        expect(await prettierApi.resolveConfig(path.join(app, "a.ts"))).toEqual({ printWidth: 140, tabWidth: 4, trailingComma: "all" });
        expect(await prettierApi.resolveConfig(path.join(app, "a.yaml"))).toMatchObject({ tabWidth: 2 });
        expect(prettier.printWidth).toBe(140);
    });
});

describe("the knip preset", () => {
    it("ignores the tools the steps run, the generated types and finds the Playwright configs, only those the app has", () => {
        const app = folder({
            "package.json": JSON.stringify({ devDependencies: { "openapi-typescript": "7", prettier: "3", vite: "8" } }),
            "src/api/openapi.d.ts": "",
            "e2e/playwright.config.ts": "",
        });

        expect(knip({ ignoreDependencies: ["tailwindcss"], entry: ["src/main.tsx"] }, app)).toEqual({
            entry: ["src/main.tsx"],
            ignore: [],
            ignoreIssues: {
                "src/api/openapi.d.ts": [
                    "files",
                    "exports",
                    "nsExports",
                    "types",
                    "nsTypes",
                    "enumMembers",
                    "namespaceMembers",
                    "duplicates",
                ],
            },
            ignoreDependencies: ["prettier", "openapi-typescript", "tailwindcss"],
            playwright: { config: ["e2e/playwright.config.ts"] },
        });
        expect(knip({}, folder({}))).toEqual({ ignore: [], ignoreIssues: {}, ignoreDependencies: [] });
    });
});

describe("the Vitest preset", () => {
    it("names the unit project the unit-tests step runs, and the stories project Chromium runs", () => {
        expect(unitTests({ extends: "./vite.config.ts", environment: "jsdom" })).toEqual({
            extends: "./vite.config.ts",
            test: { name: "unit", include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom" },
        });
        expect(storyTests({ plugin: "storybook", provider: "playwright" })).toEqual({
            plugins: ["storybook"],
            test: {
                name: "stories",
                browser: { enabled: true, provider: "playwright", headless: true, instances: [{ browser: "chromium" }] },
            },
        });
    });
});

describe("the Playwright presets", () => {
    it("run the e2e tests next to the sources, one worker, and keep the app's own settings", () => {
        const config = e2eTests({ use: { baseURL: "http://127.0.0.1:3301" }, webServer: [] });

        expect(config).toMatchObject({ testDir: "../src", testMatch: "**/*.e2e.ts", workers: 1, webServer: [] });
        expect(config.use).toEqual({
            locale: "en-US",
            trace: "retain-on-failure",
            screenshot: "only-on-failure",
            baseURL: "http://127.0.0.1:3301",
        });
    });

    it("keep the app's reporters and add the JSON report the e2e step reads only when the step asks for it", () => {
        const html = [["list"], ["html", { open: "never" }]] as const;
        const previous = process.env["PLAYWRIGHT_JSON_OUTPUT_FILE"];
        delete process.env["PLAYWRIGHT_JSON_OUTPUT_FILE"];
        try {
            expect(e2eTests({}).reporter).toEqual([["list"]]);
            expect(e2eTests({ reporter: html }).reporter).toEqual(html);
            process.env["PLAYWRIGHT_JSON_OUTPUT_FILE"] = "/run/e2e/playwright.json";
            expect(e2eTests({}).reporter).toEqual([["list"], ["json"]]);
            expect(e2eTests({ reporter: html }).reporter).toEqual([...html, ["json"]]);
            expect(e2eTests({ reporter: "dot,json" }).reporter).toEqual([["dot"], ["json"]]);
        } finally {
            if (previous === undefined) delete process.env["PLAYWRIGHT_JSON_OUTPUT_FILE"];
            else process.env["PLAYWRIGHT_JSON_OUTPUT_FILE"] = previous;
        }
    });

    it("compare every story at two screen sizes against the built Storybook", () => {
        const config = visualTests({ port: 6100 });

        expect(config.projects.map((project) => project.name)).toEqual(["1920x1080", "3440x1440"]);
        expect(config.webServer.url).toBe("http://127.0.0.1:6100/iframe.html");
    });
});
