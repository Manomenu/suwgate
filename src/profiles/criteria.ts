import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { Profile, Skip, Step, StepContext } from "../gate/contract.ts";
import { CONSUMER, VISUAL_CONFIG } from "./library.ts";
import { onPath, quoted, read, script, tracked } from "./shell.ts";

const CRITERIA_FILE = "criteria.json";

interface Kind {
    kind: string;
    paths: string[];
    how: string;
}

interface Extras {
    specs?: string;
    prose?: string[];
    kinds?: Kind[];
}

export interface CriteriaConfig {
    specs: string;
    prose: string[];
    kinds: Kind[];
}

export interface ToolPin {
    repository: string;
    commit: string;
    sha256: string;
}

const VDOC: ToolPin = {
    repository: "Manomenu/suwalski-agent-plugin",
    commit: "02a5f3d98c5caa9f69af3fa0508efa566a6d78f2",
    sha256: "d83e3a4e7c7f31bbe28d7eacc8eb5dbab8ba4298601839e827638ce716a91088",
};

const XUNIT = /<PackageReference\s+Include="xunit/i;

const TITLE = 'the id in the title: it("<id>: …")';

function prefix(context: StepContext, profile: Profile): string {
    const directory = context.directories[profile];
    return directory === undefined ? "" : `${directory}/`;
}

function scripts(directory: string): Kind[] {
    return [
        { kind: "lint (eslint)", paths: [`${directory}eslint.config.js`], how: "// <id> on the line above the rule" },
        { kind: "type check (tsc)", paths: [`${directory}tsconfig*.json`], how: "// <id> on the line above the option" },
    ];
}

function dotnetKinds(context: StepContext): Kind[] {
    const directory = prefix(context, "dotnet");
    const root = { ...context, cwd: context.root };
    const testProjects = tracked(root, ["*.csproj"])
        .filter((project) => XUNIT.test(read(root, project) ?? ""))
        .map((project) => path.posix.dirname(project));
    return [
        ...(testProjects.length === 0
            ? []
            : [
                  {
                      kind: "test (xunit)",
                      paths: testProjects.map((folder) => `${folder}/**/*.cs`),
                      how: '[Trait("criterion", "<id>")] on the test',
                  },
              ]),
        {
            kind: "lint (.NET analyzer)",
            paths: [...new Set([".editorconfig", `${directory}.editorconfig`])],
            how: "# <id> on its own line above the rule",
        },
        { kind: "banned API", paths: [`${directory}BannedSymbols.txt`], how: "the id in the message: P:…;<id> use …" },
        { kind: "build rule", paths: [`${directory}Directory.Build.props`], how: "<!-- <id> --> above the property" },
    ];
}

function webKinds(context: StepContext): Kind[] {
    const directory = prefix(context, "web");
    return [
        { kind: "e2e test (playwright)", paths: [`${directory}src/**/*.e2e.ts`], how: 'the id in the title: test("<id>: …")' },
        { kind: "web test (vitest)", paths: [`${directory}src/**/*.test.ts`, `${directory}src/**/*.test.tsx`], how: TITLE },
        ...scripts(directory),
    ];
}

function libraryKinds(context: StepContext): Kind[] {
    const directory = prefix(context, "library");
    return [
        { kind: "unit test (vitest)", paths: [`${directory}src/**/*.test.ts`, `${directory}src/**/*.test.tsx`], how: TITLE },
        {
            kind: "story test (vitest, Chromium)",
            paths: [`${directory}src/**/*.stories.tsx`],
            how: 'the id in the story\'s name: name: "<id>: …"',
        },
        {
            kind: "visual test (playwright)",
            paths: [`${directory}${path.posix.dirname(VISUAL_CONFIG)}/*.visual.ts`],
            how: 'the id in the title: test("<id>: …")',
        },
        { kind: "consumer test (playwright)", paths: [`${directory}${CONSUMER}/*.spec.ts`], how: 'the id in the title: test("<id>: …")' },
        ...scripts(directory),
    ];
}

const KINDS_BY_PROFILE: Readonly<Record<Profile, (context: StepContext) => Kind[]>> = {
    web: webKinds,
    library: libraryKinds,
    dotnet: dotnetKinds,
    database: () => [],
};

function merged(kinds: readonly Kind[]): Kind[] {
    const byName = new Map<string, Kind>();
    for (const kind of kinds) {
        const known = byName.get(kind.kind);
        byName.set(kind.kind, known === undefined ? { ...kind } : { ...known, paths: [...new Set([...known.paths, ...kind.paths])] });
    }
    return [...byName.values()];
}

function defaultKinds(context: StepContext): Kind[] {
    return merged(context.profiles.flatMap((profile) => KINDS_BY_PROFILE[profile](context)));
}

export function criteriaConfig(context: StepContext, extras: Extras): CriteriaConfig {
    return {
        specs: extras.specs ?? "docs/visual/spec",
        prose: extras.prose ?? ["docs/**", "**/*.md"],
        kinds: merged([...(extras.kinds ?? []), ...defaultKinds(context)]),
    };
}

function fail(message: string): string {
    return `echo ${quoted(message)} >&2; exit 1`;
}

function download(pin: ToolPin, tool: string): Skip | null {
    const url = `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/plugins/suwagent/scripts/vdoc.py`;
    const part = `${tool}.part`;
    try {
        mkdirSync(path.dirname(tool), { recursive: true });
        execFileSync("curl", ["-sSfL", "--max-time", "30", "-o", part, url], { stdio: "ignore" });
        renameSync(part, tool);
        return null;
    } catch {
        rmSync(part, { force: true });
        return { skip: `the pinned vdoc.py cannot be downloaded from ${url} (no network?)` };
    }
}

function cacheFolder(): string {
    const configured = process.env["XDG_CACHE_HOME"];
    return configured === undefined || configured === "" ? path.join(homedir(), ".cache") : configured;
}

export function criteria(pin: ToolPin): (context: StepContext) => string | Skip {
    return (context) => {
        if (!onPath("python3")) return { skip: "python3 not installed" };
        const tool = path.join(cacheFolder(), "suwagent", `vdoc-${pin.commit}.py`);
        if (!existsSync(tool)) {
            if (!onPath("curl")) return { skip: "curl not installed: it downloads the pinned vdoc.py" };
            const failed = download(pin, tool);
            if (failed !== null) return failed;
        }
        if (createHash("sha256").update(readFileSync(tool)).digest("hex") !== pin.sha256) {
            return fail(
                `${tool} does not match the SHA-256 suwgate pins: delete it and run again; if it still differs, the pin in suwgate is wrong`,
            );
        }
        let extras: Extras = {};
        const text = read({ ...context, cwd: context.root }, CRITERIA_FILE);
        if (text !== null) {
            try {
                extras = JSON.parse(text) as Extras;
            } catch (error) {
                return fail(`${CRITERIA_FILE} is not valid JSON (${error instanceof Error ? error.message : String(error)}): fix it`);
            }
        }
        const config = path.join(
            cacheFolder(),
            "suwgate",
            `criteria-${createHash("sha256").update(context.root).digest("hex").slice(0, 16)}.json`,
        );
        return script([
            `mkdir -p ${quoted(path.dirname(config))}`,
            `cat >${quoted(config)} <<'SUWGATE_CRITERIA'`,
            JSON.stringify(criteriaConfig(context, extras), null, 2),
            "SUWGATE_CRITERIA",
            `python3 ${quoted(tool)} criteria --root ${quoted(context.root)} --config ${quoted(config)}`,
        ]);
    };
}

export const criteriaStep: Step = {
    id: "criteria",
    title: "acceptance criteria guarded (vdoc.py criteria, the kinds of the profiles and criteria.json)",
    run: criteria(VDOC),
    limitSeconds: 60,
};
