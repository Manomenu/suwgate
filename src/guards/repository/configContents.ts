import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { Finding, Guard, GuardContext, Profile } from "../../gate/contract.ts";
import { npmDependencies } from "./packageManifests.ts";
import { baseName, inProfileDirectory, isRecord, lineAt, numberedLines, parseJson, parseJsonc } from "./text.ts";

const SUWGATE = "@maniumek/suwgate";
const NODE_PROFILES: readonly Profile[] = ["web", "library"];
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const ROLL_FORWARD_ALLOWED = ["patch", "feature", "minor", "latestPatch", "latestFeature", "latestMinor", "disable"];
const ROLL_FORWARD_MAJOR = ["major", "latestMajor"];
const TEST_RUNNER = "Microsoft.Testing.Platform";
const LINE_LENGTH = "140";
const CSHARPIER_FILES = [".cs", ".csproj", ".props", ".targets"];
const CSHARPIER_CONFIGS = [".csharpierrc", ".csharpierrc.json", ".csharpierrc.yaml", ".csharpierrc.yml"];
const TSCONFIG = /^tsconfig(\..+)?\.json$/;
const ESLINT_CONFIGS = ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", "eslint.config.mts"];
const VITEST_CONFIGS = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs"];
const PLAYWRIGHT_CONFIGS: readonly (readonly [Profile, string])[] = [
    ["web", "e2e/playwright.config.ts"],
    ["library", "visual/playwright.config.ts"],
];
const SCHEMA_PATH = `node_modules/${SUWGATE}/schema/suwgate.schema.json`;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const GATE_CALL = /^\s*(?:-\s+)?uses:\s*["']?manomenu\/suwgate\/\.github\/workflows\/gate\.ya?ml@([^\s"'#]+)/i;
const FULL_SHA = /^[0-9a-f]{40}$/;
const GATE_USES = "uses: Manomenu/suwgate/.github/workflows/gate.yml@<full 40-character commit sha>";

function directoryOf(context: GuardContext, profile: Profile): string {
    return (context.directories[profile] ?? "").replace(/\/+$/, "");
}

function joined(directory: string, file: string): string {
    return directory === "" ? file : `${directory}/${file}`;
}

function present(context: GuardContext, file: string): boolean {
    return context.files.includes(file);
}

function nodeDirectories(context: GuardContext): string[] {
    return [...new Set(NODE_PROFILES.filter((profile) => context.profiles.includes(profile)).map((p) => directoryOf(context, p)))];
}

function imports(text: string, module: string): boolean {
    const escaped = module.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+|\\brequire\\s*\\(\\s*)["']${escaped}["']`).test(text);
}

function globalJson(context: GuardContext): Finding[] {
    const file = inProfileDirectory(context.directories, "dotnet", "global.json");
    if (!present(context, file)) return [];
    const parsed = parseJsonc(context.read(file));
    if (!isRecord(parsed)) return [{ target: file, message: "not valid JSON: fix the file so the dotnet CLI can read it" }];
    const sdk = isRecord(parsed["sdk"]) ? parsed["sdk"] : {};
    const test = isRecord(parsed["test"]) ? parsed["test"] : {};
    const version = sdk["version"];
    const rollForward = sdk["rollForward"];
    const allowed = ROLL_FORWARD_ALLOWED.join(", ");
    const findings: string[] = [];
    if (typeof version !== "string" || !EXACT_VERSION.test(version)) {
        findings.push(
            `sdk.version is ${JSON.stringify(version ?? null)}: set the exact SDK version, such as "10.0.100" (major.minor.patch, no wildcard or range), so every machine and CI build with the same SDK`,
        );
    }
    if (typeof rollForward !== "string") {
        findings.push(
            `sdk.rollForward is not set: set it, for example "latestFeature" (allowed: ${allowed}), so it is written down how far the SDK may move`,
        );
    } else if (ROLL_FORWARD_MAJOR.includes(rollForward)) {
        findings.push(
            `sdk.rollForward is "${rollForward}", which lets a new major SDK build the code with other analyzers and defaults: set it to one of ${allowed}`,
        );
    } else if (!ROLL_FORWARD_ALLOWED.includes(rollForward)) {
        findings.push(`sdk.rollForward "${rollForward}" is not a value .NET knows: set it to one of ${allowed}`);
    }
    if (test["runner"] !== TEST_RUNNER) {
        findings.push(
            `test.runner is ${JSON.stringify(test["runner"] ?? null)}: set "test": { "runner": "${TEST_RUNNER}" }, the runner the dotnet-test step's dotnet test options are written for`,
        );
    }
    return findings.map((message) => ({ target: file, message }));
}

function expandBraces(glob: string): string[] {
    const match = /\{([^{}]*)\}/.exec(glob);
    if (match?.[1]?.includes(",") !== true) return [glob];
    const before = glob.slice(0, match.index);
    const after = glob.slice(match.index + match[0].length);
    return match[1].split(",").flatMap((option) => expandBraces(`${before}${option}${after}`));
}

function globPattern(glob: string): RegExp {
    const source = glob
        .replace(/[.+^${}()|\\]/g, "\\$&")
        .replaceAll("**", "\u0000")
        .replaceAll("*", "[^/]*")
        .replaceAll("?", "[^/]")
        .replaceAll("[!", "[^")
        .replaceAll("\u0000", ".*");
    return new RegExp(`^${source}$`);
}

export function appliesToEvery(glob: string, extension: string): boolean {
    return !glob.includes("/") && expandBraces(glob).some((single) => globPattern(single).test(`Any${extension}`));
}

interface EditorConfig {
    root: boolean;
    widths: { glob: string; width: string }[];
}

function editorConfig(text: string): EditorConfig {
    let glob: string | null = null;
    let root = false;
    const widths: { glob: string; width: string }[] = [];
    for (const { text: line } of numberedLines(text)) {
        const trimmed = line.trim();
        const header = /^\[(.*)\]$/.exec(trimmed);
        const property = /^([^=#;]+?)\s*=\s*(.*)$/.exec(trimmed);
        const key = property?.[1]?.toLowerCase();
        const value = property?.[2]?.trim() ?? "";
        if (header) glob = header[1] ?? "";
        else if (glob === null && key === "root") root = value.toLowerCase() === "true";
        else if (glob !== null && key === "max_line_length") widths.push({ glob, width: value });
    }
    return { root, widths };
}

function widthFor(configs: readonly EditorConfig[], extension: string): string | undefined {
    let width: string | undefined;
    for (const config of configs) {
        if (config.root) width = undefined;
        for (const section of config.widths) if (appliesToEvery(section.glob, extension)) width = section.width;
    }
    return width;
}

function lineLength(context: GuardContext): Finding[] {
    const chain = [...new Set([".editorconfig", joined(directoryOf(context, "dotnet"), ".editorconfig")])].filter((file) =>
        present(context, file),
    );
    const nearest = chain.at(-1);
    if (nearest === undefined) return [];
    const configs = chain.map((file) => editorConfig(context.read(file)));
    const wrong = CSHARPIER_FILES.map((extension) => ({ extension, width: widthFor(configs, extension) })).filter(
        ({ width }) => width !== LINE_LENGTH,
    );
    if (wrong.length === 0) return [];
    const now = wrong.map(({ extension, width }) => `*${extension}: ${width ?? "not set"}`).join(", ");
    return [
        {
            target: nearest,
            message: `max_line_length is not ${LINE_LENGTH} for every file CSharpier formats (${now}): set max_line_length = ${LINE_LENGTH} in a section such as [*.{cs,csproj,props,targets}], the width CSharpier reads from .editorconfig`,
        },
    ];
}

function csharpierConfigs(context: GuardContext): Finding[] {
    return context.files
        .filter((file) => CSHARPIER_CONFIGS.includes(baseName(file)))
        .map((file) => ({
            target: file,
            message: `delete it: CSharpier takes a .csharpierrc over .editorconfig, and the width is max_line_length = ${LINE_LENGTH} in .editorconfig`,
        }));
}

function centralPackages(context: GuardContext): Finding[] {
    const file = inProfileDirectory(context.directories, "dotnet", "Directory.Packages.props");
    if (!present(context, file)) return [];
    if (/<ManagePackageVersionsCentrally>\s*true\s*<\/ManagePackageVersionsCentrally>/i.test(context.read(file))) return [];
    return [
        {
            target: file,
            message:
                "add <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally> to a PropertyGroup, so the versions in this file are the only ones and no project pins its own",
        },
    ];
}

function extendsSuwgate(context: GuardContext, file: string, seen: Set<string>): boolean {
    if (seen.has(file) || !present(context, file)) return false;
    seen.add(file);
    const parsed = parseJsonc(context.read(file));
    const value = isRecord(parsed) ? parsed["extends"] : undefined;
    const bases = (Array.isArray(value) ? value : [value]).filter((base): base is string => typeof base === "string");
    return bases.some((base) => {
        if (base.startsWith(`${SUWGATE}/tsconfig/`)) return true;
        if (!base.startsWith(".")) return false;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), base));
        return extendsSuwgate(context, resolved.endsWith(".json") ? resolved : `${resolved}.json`, seen);
    });
}

function tsconfigs(context: GuardContext, directory: string): Finding[] {
    return context.files
        .filter((file) => path.posix.dirname(file) === (directory === "" ? "." : directory))
        .filter((file) => TSCONFIG.test(baseName(file)) && baseName(file) !== "tsconfig.build.json")
        .filter((file) => !extendsSuwgate(context, file, new Set()))
        .map((file) => ({
            target: file,
            message: `extends no ${SUWGATE}/tsconfig preset: set "extends": "${SUWGATE}/tsconfig/browser" (app code) or "${SUWGATE}/tsconfig/node" (configs, scripts, Node tests), directly or through another tsconfig of the repository that does`,
        }));
}

function importing(context: GuardContext, file: string, module: string, fix: string): Finding[] {
    if (!present(context, file) || imports(context.read(file), module)) return [];
    return [{ target: file, message: `does not import ${module}: ${fix}` }];
}

function prettier(context: GuardContext, directory: string): Finding[] {
    const json = joined(directory, ".prettierrc.json");
    const preset = `${SUWGATE}/prettier`;
    const findings = importing(
        context,
        joined(directory, "prettier.config.js"),
        preset,
        `spread the preset: import preset from "${preset}"; export default { ...preset, plugins: [...] }`,
    );
    if (present(context, json) && parseJson(context.read(json)) !== preset) {
        findings.push({
            target: json,
            message: `does not use the preset: make the whole file "${preset}" (with a plugin, spread the preset in prettier.config.js instead)`,
        });
    }
    return findings;
}

function nodeTools(context: GuardContext, directory: string): Finding[] {
    const eslint = ESLINT_CONFIGS.map((file) => joined(directory, file)).find((file) => present(context, file));
    const vitest = VITEST_CONFIGS.map((file) => joined(directory, file)).filter((file) => present(context, file));
    return [
        ...tsconfigs(context, directory),
        ...(eslint === undefined
            ? []
            : importing(context, eslint, `${SUWGATE}/eslint`, `build the config from strict() or app() of ${SUWGATE}/eslint`)),
        ...prettier(context, directory),
        ...importing(
            context,
            joined(directory, "knip.config.ts"),
            `${SUWGATE}/knip`,
            `export { default } from "${SUWGATE}/knip", or build it with knip({ entry: [...] }) from there`,
        ),
        ...vitest.flatMap((file) =>
            importing(
                context,
                file,
                `${SUWGATE}/vitest`,
                `build the projects with unitTests() or storyTests() of ${SUWGATE}/vitest, the projects unit and stories the steps run`,
            ),
        ),
    ];
}

function playwright(context: GuardContext): Finding[] {
    return PLAYWRIGHT_CONFIGS.filter(([profile]) => context.profiles.includes(profile)).flatMap(([profile, config]) =>
        importing(
            context,
            joined(directoryOf(context, profile), config),
            `${SUWGATE}/playwright`,
            `build it with defineConfig(e2eTests({ ... })) or defineConfig(visualTests()) of ${SUWGATE}/playwright`,
        ),
    );
}

function installDirectories(context: GuardContext): Map<string, Finding[]> {
    const candidates = new Set(["package.json", ...nodeDirectories(context).map((directory) => joined(directory, "package.json"))]);
    const installs = new Map<string, Finding[]>();
    for (const dependency of npmDependencies(context)) {
        if (dependency.name !== SUWGATE || !candidates.has(dependency.manifest)) continue;
        const findings = EXACT_VERSION.test(dependency.version)
            ? []
            : [
                  {
                      target: dependency.manifest,
                      line: dependency.line,
                      message: `${SUWGATE} is "${dependency.version}": pin it to an exact version, such as "0.1.2" (no ^, ~, range or tag), so the gate changes only when the repository updates it`,
                  },
              ];
        installs.set(path.posix.dirname(dependency.manifest).replace(/^\.$/, ""), findings);
    }
    return installs;
}

function releaseAge(context: GuardContext, directories: readonly string[]): Finding[] {
    return [...new Set(directories)]
        .map((directory) => joined(directory, "pnpm-workspace.yaml"))
        .filter((file) => present(context, file))
        .flatMap((file) => {
            const text = context.read(file);
            let parsed: unknown;
            try {
                parsed = parseYaml(text);
            } catch {
                return [{ target: file, message: "not valid YAML: fix the file so pnpm can read it" }];
            }
            if (!isRecord(parsed) || !("minimumReleaseAge" in parsed)) return [];
            const age = parsed["minimumReleaseAge"];
            if (typeof age === "number" && age > 0) return [];
            return [
                {
                    target: file,
                    line: lineAt(text, Math.max(0, text.indexOf("minimumReleaseAge:"))),
                    message: `minimumReleaseAge is ${JSON.stringify(age)}, so pnpm installs a release minutes after it is published: delete the line (pnpm waits 1440 minutes by default) or set more minutes, and put a package needed sooner into minimumReleaseAgeExclude`,
                },
            ];
        });
}

function schemaMapped(schemas: Record<string, unknown>, directories: readonly string[]): boolean {
    const accepted = new Set(directories.flatMap((directory) => [joined(directory, SCHEMA_PATH), `./${joined(directory, SCHEMA_PATH)}`]));
    return Object.entries(schemas).some(
        ([schema, targets]) => accepted.has(schema) && (Array.isArray(targets) ? targets : [targets]).includes("suwgate.yml"),
    );
}

function yamlSchemas(context: GuardContext, installs: readonly string[]): Finding[] {
    const file = ".vscode/settings.json";
    if (!present(context, file)) return [];
    const settings = parseJson(context.read(file));
    if (!isRecord(settings)) return [];
    const schemas = isRecord(settings["yaml.schemas"]) ? settings["yaml.schemas"] : {};
    const profileDirectories = Object.values(context.directories).map((directory) => directory.replace(/\/+$/, ""));
    if (schemaMapped(schemas, ["", ...installs, ...profileDirectories])) return [];
    const schema = `./${joined(installs[0] ?? "", SCHEMA_PATH)}`;
    return [
        {
            target: file,
            message: `yaml.schemas does not map suwgate's schema to suwgate.yml: add "yaml.schemas": { "${schema}": "suwgate.yml" }, so VS Code checks suwgate.yml as you type`,
        },
    ];
}

function gateWorkflow(context: GuardContext): Finding[] {
    const workflows = context.files.filter((file) => WORKFLOW.test(file));
    if (workflows.length === 0) return [];
    const calls = workflows.flatMap((file) =>
        numberedLines(context.read(file)).flatMap(({ line, text }) => {
            const ref = GATE_CALL.exec(text)?.[1];
            return ref === undefined ? [] : [{ file, line, ref }];
        }),
    );
    if (calls.length === 0) {
        return [
            {
                target: ".github/workflows",
                message: `no job calls suwgate's gate: add a job with ${GATE_USES}, so CI runs the same gate as suwgate check`,
            },
        ];
    }
    return calls
        .filter(({ ref }) => !FULL_SHA.test(ref))
        .map(({ file, line, ref }) => ({
            target: file,
            line,
            message: `the gate is called at ${ref}, which can move: pin it by the commit, ${GATE_USES}`,
        }));
}

export const configContents: Guard = {
    id: "config-contents",
    description:
        "The config files suwgate relies on say what it needs: the SDK and test runner, the C# line width, the tool presets, an exact suwgate version, pnpm's release age, the schema in VS Code and the pinned gate workflow",
    profiles: "every",
    check(context) {
        const dotnet = context.profiles.includes("dotnet");
        const installs = installDirectories(context);
        return [
            ...(dotnet ? [...globalJson(context), ...lineLength(context), ...csharpierConfigs(context), ...centralPackages(context)] : []),
            ...nodeDirectories(context).flatMap((directory) => nodeTools(context, directory)),
            ...playwright(context),
            ...[...installs.values()].flat(),
            ...releaseAge(context, [...nodeDirectories(context), ...installs.keys()]),
            ...yamlSchemas(context, [...installs.keys()]),
            ...gateWorkflow(context),
        ];
    },
};
