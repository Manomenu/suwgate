import { describe, expect, it } from "vitest";

import type { GuardContext } from "../../gate/contract.ts";
import { appliesToEvery, configContents } from "./configContents.ts";
import { findingsOf, shown } from "./testRepository.ts";

const DOTNET: Partial<GuardContext> = { profiles: ["dotnet"] };
const WEB: Partial<GuardContext> = { profiles: ["web"], directories: { web: "Myapp.Web" } };

const json = (value: unknown) => JSON.stringify(value, null, 4);

const messages = async (files: Record<string, string>, extra: Partial<GuardContext>) =>
    (await findingsOf(configContents, files, extra)).map((finding) => finding.message);

describe("config-contents: global.json", () => {
    const globalJson = (sdk: unknown, runner: unknown = "Microsoft.Testing.Platform") => ({
        "global.json": json({ sdk, test: { runner } }),
    });

    it("passes an exact SDK, a roll-forward short of a major and Microsoft.Testing.Platform, comments and all", async () => {
        expect(await messages(globalJson({ version: "10.0.100", rollForward: "latestFeature" }), DOTNET)).toEqual([]);
        expect(await messages(globalJson({ version: "10.0.100-rc.2.25502.107", rollForward: "disable" }), DOTNET)).toEqual([]);
        const commented =
            '{\n    // the SDK\n    "sdk": { "version": "10.0.100", "rollForward": "patch", },\n    "test": { "runner": "Microsoft.Testing.Platform" }\n}';
        expect(await messages({ "global.json": commented }, DOTNET)).toEqual([]);
    });

    it.each([
        [{ version: "10.0", rollForward: "latestFeature" }, 'sdk.version is "10.0": set the exact SDK version'],
        [{ rollForward: "latestFeature" }, "sdk.version is null: set the exact SDK version"],
        [{ version: "10.0.100" }, "sdk.rollForward is not set: set it"],
        [
            { version: "10.0.100", rollForward: "latestMajor" },
            'sdk.rollForward is "latestMajor", which lets a new major SDK build the code',
        ],
        [{ version: "10.0.100", rollForward: "major" }, 'sdk.rollForward is "major"'],
        [{ version: "10.0.100", rollForward: "newest" }, 'sdk.rollForward "newest" is not a value .NET knows'],
    ])("finds the SDK %j", async (sdk, message) => {
        expect(await messages(globalJson(sdk), DOTNET)).toEqual([expect.stringContaining(message)]);
    });

    it("asks for the Microsoft.Testing.Platform runner", async () => {
        expect(await messages(globalJson({ version: "10.0.100", rollForward: "latestFeature" }, "VSTest"), DOTNET)).toEqual([
            'test.runner is "VSTest": set "test": { "runner": "Microsoft.Testing.Platform" }, the runner the dotnet-test step\'s dotnet test options are written for',
        ]);
    });

    it("reads the dotnet profile's directory, and nothing without the profile or the file", async () => {
        const files = { "Myapp/global.json": json({ sdk: { version: "10" } }) };
        expect(shown(await findingsOf(configContents, files, { profiles: ["dotnet"], directories: { dotnet: "Myapp" } }))).toEqual([
            "Myapp/global.json",
            "Myapp/global.json",
            "Myapp/global.json",
        ]);
        expect(await messages(files, DOTNET)).toEqual([]);
        expect(await messages({ "global.json": "{}" }, { profiles: ["web"] })).toEqual([]);
    });
});

describe("config-contents: the C# line width", () => {
    it.each([
        ["*", true],
        ["*.cs", true],
        ["*.{cs,csproj,props,targets}", true],
        ["**.cs", true],
        ["*.{json,yml}", false],
        ["Program.cs", false],
        ["src/**.cs", false],
    ])("knows whether [%s] applies to every .cs file", (glob, expected) => {
        expect(appliesToEvery(glob, ".cs")).toBe(expected);
    });

    const editorconfig = (text: string) => ({ ".editorconfig": text });

    it("passes max_line_length = 140 for C# and the MSBuild files", async () => {
        expect(
            await messages(
                editorconfig("root = true\n\n[*]\nindent_size = 4\n\n[*.{cs,csproj,props,targets}]\nmax_line_length = 140\n"),
                DOTNET,
            ),
        ).toEqual([]);
        expect(await messages(editorconfig("[*]\nmax_line_length = 140\n"), DOTNET)).toEqual([]);
    });

    it("finds a width that is missing, different, overridden later or set for C# alone", async () => {
        expect(await messages(editorconfig("[*]\nindent_size = 4\n"), DOTNET)).toEqual([
            expect.stringContaining("(*.cs: not set, *.csproj: not set, *.props: not set, *.targets: not set): set max_line_length = 140"),
        ]);
        expect(await messages(editorconfig("[*]\nmax_line_length = 140\n[*.cs]\nmax_line_length = 120\n"), DOTNET)).toEqual([
            expect.stringContaining("(*.cs: 120)"),
        ]);
        expect(await messages(editorconfig("[*.cs]\nmax_line_length = 140\n"), DOTNET)).toEqual([
            expect.stringContaining("(*.csproj: not set, *.props: not set, *.targets: not set)"),
        ]);
    });

    it("lets the dotnet directory's .editorconfig override the root's, unless it is root = true", async () => {
        const extra = { profiles: ["dotnet"], directories: { dotnet: "Myapp" } } as const;
        const root = "[*]\nmax_line_length = 140\n";

        expect(await messages({ ".editorconfig": root, "Myapp/.editorconfig": "[*.cs]\nindent_size = 4\n" }, extra)).toEqual([]);
        expect(shown(await findingsOf(configContents, { ".editorconfig": root, "Myapp/.editorconfig": "root = true\n" }, extra))).toEqual([
            "Myapp/.editorconfig",
        ]);
    });

    it("finds a leftover .csharpierrc, which CSharpier takes over .editorconfig", async () => {
        const files = {
            ".editorconfig": "[*]\nmax_line_length = 140\n",
            ".csharpierrc.json": "{}",
            "src/.csharpierrc.yaml": "",
            "src/.csharpierrc": "",
        };
        const findings = await findingsOf(configContents, files, DOTNET);

        expect(shown(findings)).toEqual([".csharpierrc.json", "src/.csharpierrc.yaml", "src/.csharpierrc"]);
        expect(findings[0]?.message).toBe(
            "delete it: CSharpier takes a .csharpierrc over .editorconfig, and the width is max_line_length = 140 in .editorconfig",
        );
    });
});

describe("config-contents: Directory.Packages.props", () => {
    it("asks for central package management", async () => {
        const props = (value: string) => ({
            "Directory.Packages.props": `<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>${value}</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n</Project>`,
        });

        expect(await messages(props("true"), DOTNET)).toEqual([]);
        expect(await messages(props("false"), DOTNET)).toEqual([
            expect.stringContaining("add <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally> to a PropertyGroup"),
        ]);
    });
});

describe("config-contents: the tool presets", () => {
    const passing = {
        "Myapp.Web/tsconfig.json": json({ extends: "@maniumek/suwgate/tsconfig/browser", include: ["src"] }),
        "Myapp.Web/tsconfig.node.json": json({ extends: ["./tsconfig.base"], include: ["*.config.ts"] }),
        "Myapp.Web/tsconfig.base.json": '{\n    // criterion-1\n    "extends": "@maniumek/suwgate/tsconfig/node",\n}',
        "Myapp.Web/tsconfig.build.json": json({ compilerOptions: {} }),
        "Myapp.Web/eslint.config.js":
            'import { app } from "@maniumek/suwgate/eslint";\n\nexport default app({ root: import.meta.dirname, features: [] });\n',
        "Myapp.Web/.prettierrc.json": '"@maniumek/suwgate/prettier"\n',
        "Myapp.Web/knip.config.ts": 'export { default } from "@maniumek/suwgate/knip";\n',
        "Myapp.Web/vitest.config.ts": 'import { unitTests } from "@maniumek/suwgate/vitest";\n',
        "Myapp.Web/e2e/playwright.config.ts": 'import { e2eTests } from "@maniumek/suwgate/playwright";\n',
    };

    it("passes configs that extend or import suwgate's presets, directly or through a tsconfig of the repository", async () => {
        expect(await messages(passing, WEB)).toEqual([]);
        expect(
            await messages({ "prettier.config.js": 'import preset from "@maniumek/suwgate/prettier";\n' }, { profiles: ["library"] }),
        ).toEqual([]);
    });

    it("finds each config that does not use the preset, and says how to use it", async () => {
        const failing = {
            "Myapp.Web/tsconfig.json": json({ compilerOptions: { strict: true } }),
            "Myapp.Web/tsconfig.node.json": json({ extends: "./tsconfig.json" }),
            "Myapp.Web/tsconfig.loop.json": json({ extends: "./tsconfig.loop.json" }),
            "Myapp.Web/eslint.config.js": 'import js from "@eslint/js";\n',
            "Myapp.Web/.prettierrc.json": json({ printWidth: 140 }),
            "Myapp.Web/prettier.config.js": "export default {};\n",
            "Myapp.Web/knip.config.ts": "export default {};\n",
            "Myapp.Web/vitest.config.ts": 'import { defineConfig } from "vitest/config";\n',
            "Myapp.Web/e2e/playwright.config.ts": 'import { defineConfig } from "@playwright/test";\n',
        };
        const findings = await findingsOf(configContents, failing, WEB);

        expect(shown(findings)).toEqual([
            "Myapp.Web/tsconfig.json",
            "Myapp.Web/tsconfig.node.json",
            "Myapp.Web/tsconfig.loop.json",
            "Myapp.Web/eslint.config.js",
            "Myapp.Web/prettier.config.js",
            "Myapp.Web/.prettierrc.json",
            "Myapp.Web/knip.config.ts",
            "Myapp.Web/vitest.config.ts",
            "Myapp.Web/e2e/playwright.config.ts",
        ]);
        expect(findings[0]?.message).toContain('set "extends": "@maniumek/suwgate/tsconfig/browser" (app code)');
        expect(findings[3]?.message).toBe(
            "does not import @maniumek/suwgate/eslint: build the config from strict() or app() of @maniumek/suwgate/eslint",
        );
        expect(findings[5]?.message).toContain('make the whole file "@maniumek/suwgate/prettier"');
    });

    it("reads the visual tests' Playwright config of a library, and no tool config without a web or library profile", async () => {
        const files = { "visual/playwright.config.ts": "export default {};\n", "e2e/playwright.config.ts": "export default {};\n" };

        expect(shown(await findingsOf(configContents, files, { profiles: ["library"] }))).toEqual(["visual/playwright.config.ts"]);
        expect(await messages({ "tsconfig.json": "{}", "eslint.config.js": "" }, DOTNET)).toEqual([]);
    });
});

describe("config-contents: the installed suwgate", () => {
    const manifest = (version: string) => json({ devDependencies: { "@maniumek/suwgate": version } });

    it("asks for an exact version of @maniumek/suwgate where it is installed", async () => {
        expect(await messages({ "Myapp.Web/package.json": manifest("0.1.2") }, WEB)).toEqual([]);
        for (const version of ["^0.1.2", "~0.1.2", "latest", "0.1"]) {
            const findings = await findingsOf(configContents, { "Myapp.Web/package.json": manifest(version) }, WEB);
            expect(shown(findings)).toEqual(["Myapp.Web/package.json:3"]);
            expect(findings[0]?.message).toContain(`@maniumek/suwgate is "${version}": pin it to an exact version`);
        }
        expect(await messages({ "tools/package.json": manifest("^0.1.2") }, WEB)).toEqual([]);
    });

    it("refuses a minimumReleaseAge of 0 in the web or library directory and where suwgate is installed", async () => {
        const workspace = (age: string) => `minimumReleaseAge: ${age}\nminimumReleaseAgeExclude:\n  - "@maniumek/*"\n`;

        expect(await messages({ "Myapp.Web/pnpm-workspace.yaml": workspace("2880") }, WEB)).toEqual([]);
        expect(await messages({ "Myapp.Web/pnpm-workspace.yaml": "minimumReleaseAgeExclude: [vite]\n" }, WEB)).toEqual([]);
        const findings = await findingsOf(configContents, { "Myapp.Web/pnpm-workspace.yaml": `allowBuilds: {}\n${workspace("0")}` }, WEB);
        expect(shown(findings)).toEqual(["Myapp.Web/pnpm-workspace.yaml:2"]);
        expect(findings[0]?.message).toContain("minimumReleaseAge is 0, so pnpm installs a release minutes after it is published");
        const dotnetOnly = { "package.json": manifest("0.1.2"), "pnpm-workspace.yaml": workspace("0") };
        expect(shown(await findingsOf(configContents, dotnetOnly, DOTNET))).toEqual(["pnpm-workspace.yaml:1"]);
        expect(await messages({ "pnpm-workspace.yaml": workspace("0") }, DOTNET)).toEqual([]);
    });

    it("asks .vscode/settings.json to map suwgate's schema to suwgate.yml", async () => {
        const settings = (schemas: unknown) => ({
            ".vscode/settings.json": json({ "yaml.schemas": schemas }),
            "Myapp.Web/package.json": manifest("0.1.2"),
        });

        expect(
            await messages(settings({ "./Myapp.Web/node_modules/@maniumek/suwgate/schema/suwgate.schema.json": "suwgate.yml" }), WEB),
        ).toEqual([]);
        expect(await messages(settings({ "node_modules/@maniumek/suwgate/schema/suwgate.schema.json": ["suwgate.yml"] }), WEB)).toEqual([]);
        expect(await messages(settings({ "./schema/other.json": "suwgate.yml" }), WEB)).toEqual([
            'yaml.schemas does not map suwgate\'s schema to suwgate.yml: add "yaml.schemas": { "./Myapp.Web/node_modules/@maniumek/suwgate/schema/suwgate.schema.json": "suwgate.yml" }, so VS Code checks suwgate.yml as you type',
        ]);
        expect(await messages({ ".vscode/settings.json": "{}" }, DOTNET)).toEqual([
            expect.stringContaining('"./node_modules/@maniumek/suwgate/schema/suwgate.schema.json": "suwgate.yml"'),
        ]);
    });
});

describe("config-contents: the gate workflow", () => {
    const sha = "7c8432804c9be044a08fe2228b9532b7f82dcb38";
    const workflow = (uses: string) => `jobs:\n  gate:\n    uses: ${uses}\n    with:\n      dotnet: true\n`;

    it("passes a job that calls suwgate's gate pinned by its full commit sha", async () => {
        expect(
            await messages({ ".github/workflows/ci.yml": workflow(`Manomenu/suwgate/.github/workflows/gate.yml@${sha}`) }, DOTNET),
        ).toEqual([]);
    });

    it("finds a gate called at a tag or a branch, and CI that never calls the gate", async () => {
        const findings = await findingsOf(
            configContents,
            { ".github/workflows/ci.yml": workflow("Manomenu/suwgate/.github/workflows/gate.yml@v0.1.2") },
            DOTNET,
        );
        expect(shown(findings)).toEqual([".github/workflows/ci.yml:3"]);
        expect(findings[0]?.message).toContain("the gate is called at v0.1.2, which can move: pin it by the commit");

        const none = await findingsOf(configContents, { ".github/workflows/ci.yml": workflow("./.github/workflows/gate.yml") }, DOTNET);
        expect(shown(none)).toEqual([".github/workflows"]);
        expect(none[0]?.message).toContain(
            "no job calls suwgate's gate: add a job with uses: Manomenu/suwgate/.github/workflows/gate.yml@<full 40-character commit sha>",
        );
        expect(await messages({}, DOTNET)).toEqual([]);
    });
});
