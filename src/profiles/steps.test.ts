import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Profile, Run, Step, StepContext } from "../gate/contract.ts";
import { contractPins, apiContract } from "./contract.ts";
import { criteria, criteriaConfig } from "./criteria.ts";
import { guardTests, inCheckoutEnv } from "./dotnet.ts";
import { stepsFor } from "./index.ts";
import { attw, consumerApp, visual } from "./library.ts";
import { typecheck, unitTests } from "./node.ts";
import { readRun } from "./reports.ts";

const folders: string[] = [];

function repository(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-profiles-"));
    folders.push(root);
    execFileSync("git", ["init", "-q", "-b", "master"], { cwd: root });
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    return root;
}

afterEach(() => {
    vi.unstubAllEnvs();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

interface Where {
    profile?: Profile;
    profiles?: Profile[];
    directories?: Partial<Record<Profile, string>>;
    changed?: string[];
    skippedGuards?: string[];
    settings?: Record<string, unknown>;
}

function context(root: string, where: Where = {}): StepContext {
    const directories = where.directories ?? {};
    const directory = where.profile === undefined ? undefined : directories[where.profile];
    return {
        root,
        cwd: path.join(root, directory ?? ""),
        quick: false,
        profiles: where.profiles ?? (where.profile === undefined ? [] : [where.profile]),
        directories,
        skippedSteps: [],
        skippedGuards: where.skippedGuards ?? [],
        settings: where.settings ?? {},
        changed: () => where.changed ?? [],
    };
}

function step(id: string, profiles: Profile[] = ["web", "library", "dotnet", "database"]): Step {
    const found = stepsFor(profiles).find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`no step ${id}`);
    return found;
}

function line(run: Run | true | undefined, at: StepContext): ReturnType<Exclude<Run, string>> | undefined {
    if (run === undefined || run === true) return undefined;
    return typeof run === "string" ? run : run(at);
}

describe("the steps of the profiles", () => {
    it("run each profile's steps once, in the order web, library, dotnet, database, then every repository's", () => {
        expect(stepsFor(["web", "dotnet", "database"]).map((candidate) => candidate.id)).toEqual([
            "pnpm-install",
            "typecheck",
            "lint",
            "unit-tests",
            "format",
            "knip",
            "e2e",
            "api-contract",
            "api-version",
            "contract-pins",
            "dotnet-build",
            "dotnet-format",
            "dotnet-test",
            "database-up",
            "compose",
            "criteria",
            "criteria-ran",
            "shellcheck",
            "gitleaks",
        ]);
        expect(stepsFor(["library"]).map((candidate) => candidate.id)).toEqual([
            "pnpm-install",
            "typecheck",
            "lint",
            "unit-tests",
            "format",
            "knip",
            "stories",
            "publint",
            "attw",
            "consumer-app",
            "visual",
            "changeset",
            "compose",
            "criteria",
            "criteria-ran",
            "shellcheck",
            "gitleaks",
        ]);
    });

    it("name only steps that exist, or that another profile brings, in after", () => {
        const all = stepsFor(["web", "library", "dotnet", "database"]);
        const ids = all.map((candidate) => candidate.id);
        expect(all.flatMap((candidate) => (candidate.after ?? []).filter((after) => !ids.includes(after)))).toEqual([]);
        expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
        expect(all.flatMap((candidate) => (candidate.orderAfter ?? []).filter((after) => !ids.includes(after)))).toEqual([]);
    });

    it("put the arguments of suwgate step where the tool takes them exactly when a step says it takes them", () => {
        const root = repository({
            "suwgate.yml": "profiles: [web, library, dotnet]\n",
            ".storybook/main.ts": "",
            "visual/playwright.config.ts": "",
            "node_modules/@playwright/test/package.json": JSON.stringify({ version: "1.50.0" }),
            "gate/consumer/app/package.json": "{}",
            "gate/consumer/playwright.config.ts": "",
            "e2e/playwright.config.ts": "",
        });
        const at = context(root, { profiles: ["web", "library", "dotnet"] });
        const taking = stepsFor(["web", "library", "dotnet", "database"]).flatMap((candidate) => {
            const command = line(candidate.run, at);
            return typeof command === "string" && command.includes('"$@"') ? [candidate.id] : [];
        });
        const declared = stepsFor(["web", "library", "dotnet", "database"]).flatMap((candidate) =>
            candidate.args === undefined ? [] : [candidate.id],
        );

        expect(taking.sort()).toEqual(declared.sort());
        expect(declared.sort()).toEqual(["consumer-app", "dotnet-test", "e2e", "stories", "unit-tests", "visual"]);
    });
});

describe("pnpm-install", () => {
    it("installs from the lockfile only when node_modules is missing", () => {
        const root = repository({ "Myapp.Web/package.json": "{}" });
        const where = context(root, { profile: "web", directories: { web: "Myapp.Web" } });

        expect(line(step("pnpm-install").run, where)).toBe("pnpm install --frozen-lockfile --silent");
        mkdirSync(path.join(root, "Myapp.Web/node_modules"));
        expect(line(step("pnpm-install").run, where)).toBeNull();
    });
});

describe("typecheck", () => {
    it("checks every tsconfig*.json but the build one, tsconfig.json first", () => {
        const root = repository({
            "tsconfig.json": "{}",
            "tsconfig.node.json": "{}",
            "tsconfig.build.json": "{}",
            "tsconfig.app.json": "{}",
        });

        const checks = typecheck(context(root))
            .split(" && ")
            .filter((part) => part.startsWith("pnpm exec tsc --noEmit"));
        expect(checks).toEqual([
            "pnpm exec tsc --noEmit -p tsconfig.json",
            "pnpm exec tsc --noEmit -p tsconfig.app.json",
            "pnpm exec tsc --noEmit -p tsconfig.node.json",
        ]);
        expect(typecheck(context(root))).toContain("pnpm exec tsc --showConfig -p tsconfig.node.json | ");
        expect(typecheck(context(root))).toContain("verdict tsconfig 'tsconfig.node.json'");
    });

    it("runs in --quick only when code of its directory changed", () => {
        const root = repository({ "Myapp.Web/tsconfig.json": "{}" });
        const quick = step("typecheck").quick;
        const directories = { web: "Myapp.Web" };

        expect(line(quick, context(root, { profile: "web", directories, changed: ["Myapp.Web/README.md", "src/a.ts"] }))).toBeNull();
        expect(line(quick, context(root, { profile: "web", directories, changed: ["Myapp.Web/src/a.tsx"] }))).toMatch(
            /^pnpm exec tsc --noEmit -p tsconfig\.json && pnpm exec tsc --showConfig -p tsconfig\.json \| .* verdict tsconfig 'tsconfig\.json'$/,
        );
    });
});

describe("unit-tests", () => {
    it("runs the project named unit when the Vitest config has it, otherwise every test", () => {
        expect(unitTests(context(repository({ "vite.config.ts": "export default {};" })))).toContain(
            "&& pnpm exec vitest run --reporter=default",
        );
        expect(
            unitTests(context(repository({ "vitest.config.ts": 'projects: [{ test: { name: "unit" } }, { test: { name: "stories" } }]' }))),
        ).toContain("&& pnpm exec vitest run --project unit --reporter=default");
        expect(
            unitTests(context(repository({ "vitest.config.ts": 'projects: [unitTests({ environment: "jsdom" }), storyTests(options)]' }))),
        ).toContain("&& pnpm exec vitest run --project unit --reporter=default");
    });
});

describe("stories and visual", () => {
    it("need a Storybook, and visual its Playwright config, else there is nothing to check", () => {
        const bare = context(repository({ "package.json": "{}" }), { profile: "library" });

        expect(line(step("stories").run, bare)).toBeNull();
        expect(visual(bare)).toBeNull();
    });

    it("runs the visual tests in the Playwright image of the installed version, or says what to install", () => {
        const files = { ".storybook/main.ts": "", "visual/playwright.config.ts": "" };
        const root = repository(files);

        expect(visual(context(root))).toContain("pnpm add -D @playwright/test");
        writeFileSync(path.join(root, ".storybook/main.ts"), "");
        mkdirSync(path.join(root, "node_modules/@playwright/test"), { recursive: true });
        writeFileSync(path.join(root, "node_modules/@playwright/test/package.json"), '{ "version": "1.65.1" }');
        expect(visual(context(root))).toContain(
            "mcr.microsoft.com/playwright:v1.65.1-noble node_modules/.bin/playwright test -c visual/playwright.config.ts",
        );
        expect(line(step("stories").run, context(root))).toContain("&& pnpm exec vitest run --project stories --reporter=default");
    });
});

describe("attw and consumer-app", () => {
    it("leaves the CSS and JSON entry points out of attw", () => {
        const root = repository({
            "package.json": JSON.stringify({
                exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" }, "./theme.css": "./dist/theme.css" },
            }),
        });

        expect(attw(context(root))).toBe("pnpm exec attw --pack . --profile esm-only --exclude-entrypoints './theme.css'");
        expect(attw(context(repository({ "package.json": "{}" })))).toBe("pnpm exec attw --pack . --profile esm-only");
    });

    it("installs the tarball into gate/consumer/app, builds it with its build script or vite, and runs its Playwright tests", () => {
        expect(consumerApp(context(repository({ "package.json": "{}" })))).toBeNull();
        const vite = consumerApp(context(repository({ "gate/consumer/playwright.config.ts": "", "gate/consumer/app/package.json": "{}" })));
        expect(vite).toContain('pnpm add "$tarball" --silent && pnpm exec vite build --logLevel warn');
        expect(vite).toContain("pnpm exec playwright test -c gate/consumer/playwright.config.ts");
        const scripted = consumerApp(
            context(
                repository({
                    "gate/consumer/playwright.config.ts": "",
                    "gate/consumer/app/package.json": '{ "scripts": { "build": "vite build" } }',
                }),
            ),
        );
        expect(scripted).toContain("&& pnpm run build)");
    });
});

const TEST_OPTIONS =
    '-p:CustomAfterMicrosoftCommonTargets="$run/report-names.targets" --no-build --no-progress --zero-tests-policy strict --report-xunit-xml --results-directory "$run/results"';

describe("dotnet-test --quick", () => {
    const files = {
        "Myapp.Server/Myapp.Server.csproj": "<Project />",
        "Myapp.Gate/Myapp.Gate.csproj": '<PackageReference Include="xunit.v3" /><PackageReference Include="Suwgate.Architecture" />',
    };

    it("tests only the projects that use the .NET guards, and only when .NET changed", () => {
        const root = repository(files);

        expect(guardTests(context(root, { changed: ["README.md"] }))).toBeNull();
        expect(guardTests(context(root, { changed: ["Myapp.Server/Program.cs"] }))).toBe(
            `dotnet test --project 'Myapp.Gate/Myapp.Gate.csproj' ${TEST_OPTIONS}`,
        );
        expect(guardTests(context(repository({ "A/A.csproj": "<Project />" }), { changed: ["A/B.cs"] }))).toBeNull();
        const packages = repository({
            "dotnet/Suwgate.Architecture/Suwgate.Architecture.csproj": "<PackageId>Suwgate.Architecture</PackageId>",
            "dotnet/Suwgate.Database/Suwgate.Database.csproj":
                '<ProjectReference Include="../Suwgate.Architecture/Suwgate.Architecture.csproj" />',
            "dotnet/Suwgate.Tests/Suwgate.Tests.csproj":
                '<PackageReference Include="xunit.v3" /><ProjectReference Include="..\\Suwgate.Architecture\\Suwgate.Architecture.csproj" />',
        });
        expect(guardTests(context(packages, { changed: ["dotnet/Suwgate.Architecture/A.cs"] }))).toBe(
            `dotnet test --project 'dotnet/Suwgate.Tests/Suwgate.Tests.csproj' ${TEST_OPTIONS}`,
        );
    });

    it("finds a gate project that references the guards with Update, as the Suwgate.Architecture README tells it to", () => {
        const root = repository({
            "Myapp.Gate/Myapp.Gate.csproj": '<PackageReference Include="xunit.v3" /><PackageReference Update="Suwgate.Architecture" />',
        });

        expect(guardTests(context(root, { changed: ["Myapp.Gate/A.cs"] }))).toBe(
            `dotnet test --project 'Myapp.Gate/Myapp.Gate.csproj' ${TEST_OPTIONS}`,
        );
    });
});

describe("the .NET steps", () => {
    it("leave no idle MSBuild worker or build server behind", () => {
        const root = repository({ "suwgate.yml": "profiles: [dotnet]\n" });
        const at = context(root, { profile: "dotnet", changed: ["A.cs"] });

        for (const id of ["dotnet-build", "dotnet-format", "dotnet-test"]) {
            expect(line(step(id).run, at)).toContain("export MSBUILDDISABLENODEREUSE=1 DOTNET_CLI_USE_MSBUILD_SERVER=0 && ");
        }
        expect(line(step("dotnet-format").quick, at)).toContain("export MSBUILDDISABLENODEREUSE=1");
    });

    it("run the tests with the checkout's variables when suwgate.yml has a dev section", () => {
        const root = repository({ "suwgate.yml": "profiles: [dotnet]\ndev:\n  name: myapp\n" });
        vi.stubEnv("CI", "");
        vi.stubEnv("E2E_DATABASE", "");
        const command = inCheckoutEnv(context(root, { profile: "dotnet" }), 'echo "$MSBUILDDISABLENODEREUSE $E2E_DATABASE"');

        expect(command).toContain("dev checkout-env");
        expect(execFileSync("bash", ["-c", command], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()).toBe(
            "1 myapp_e2e",
        );
        expect(inCheckoutEnv(context(repository({ "suwgate.yml": "profiles: [dotnet]\n" })), "dotnet test")).not.toContain("checkout-env");
    });

    it("leave the tests of excludeTraits out, and ask the guards' evidence only of a run without arguments", () => {
        const root = repository({ "suwgate.yml": "profiles: [dotnet]\n" });
        const command = line(
            step("dotnet-test").run,
            context(root, { profile: "dotnet", settings: { "dotnet-test": { excludeTraits: ["live=true"] } } }),
        );

        expect(command).toContain("--filter-not-trait 'live=true' ${1:+--ignore-exit-code 8} \"$@\"");
        expect(command).toContain("{ [ $# -gt 0 ] || ");
        expect(line(step("dotnet-test").run, context(root, { profile: "dotnet" }))).not.toContain("--filter-not-trait");
    });

    it("with arguments, let a test project the filter misses pass, and fail only when no test of the whole run ran", () => {
        const fakeDotnet = (results: string): string =>
            [
                "#!/usr/bin/env bash",
                'echo "$*" >"$CALLS"',
                'while [ $# -gt 0 ]; do [ "$1" = --results-directory ] && dir="$2"; shift; done',
                'mkdir -p "$dir"',
                `echo '<assemblies><assembly><collection>${results}</collection></assembly></assemblies>' >"$dir/a.xunit.xml"`,
            ].join("\n");
        const run = (results: string, args: string[]): { status: number | null; calls: string; output: string } => {
            const root = repository({ "suwgate.yml": "profiles: [dotnet]\n", "bin/dotnet": fakeDotnet(results) });
            execFileSync("chmod", ["+x", "bin/dotnet"], { cwd: root });
            const command = line(step("dotnet-test").run, context(root, { profile: "dotnet" }));
            if (typeof command !== "string") throw new Error("no command");
            const calls = path.join(root, "calls.log");
            const env = { ...process.env, PATH: `${path.join(root, "bin")}:${process.env["PATH"] ?? ""}`, CALLS: calls, SUWGATE_RUN: root };
            const result = spawnSync("bash", ["-c", command, "suwgate", ...args], { cwd: root, env, encoding: "utf8" });
            return { status: result.status, calls: readFileSync(calls, "utf8").trim(), output: result.stdout + result.stderr };
        };

        const filtered = run('<test name="A.Notes.Saves" result="Pass" />', ["--filter-class", "*Notes*"]);
        expect(filtered.status).toBe(0);
        expect(filtered.calls).toContain("--zero-tests-policy strict");
        expect(filtered.calls).toMatch(/--ignore-exit-code 8 --filter-class \*Notes\*$/);

        const nothing = run('<test name="A.Notes.Saves" result="Skip" />', ["--filter-class", "*Nothing*"]);
        expect(nothing.status).not.toBe(0);
        expect(nothing.output).toContain("dotnet test ran 0 tests");

        expect(run('<test name="A.Notes.Saves" result="Pass" />', []).calls).not.toContain("--ignore-exit-code");
    });

    it("give each test project its own xUnit report, so projects that start in the same microsecond keep both reports", () => {
        const fakeDotnet = [
            "#!/usr/bin/env bash",
            'for arg in "$@"; do case "$arg" in -p:CustomAfterMicrosoftCommonTargets=*) targets="${arg#*=}" ;; esac; done',
            'while [ $# -gt 0 ]; do [ "$1" = --results-directory ] && dir="$2"; shift; done',
            'mkdir -p "$dir"',
            "report() {",
            '    name="runner_host_2026-11-20_12_42_52.819352.xunit.xml"',
            '    [ -f "$targets" ] && name="$(sed -n \'s/.*--report-xunit-xml-filename &quot;\\([^&]*\\)&quot;.*/\\1/p\' "$targets" | sed "s/\\$(MSBuildProjectName)/$1/; s/\\$(TargetFramework)/net10.0/")"',
            '    echo "<assemblies><assembly><collection>$2</collection></assembly></assemblies>" >"$dir/$name"',
            "}",
            'report App.Tests \'<test name="App.Tests.Saves" result="Pass"><traits><trait name="criterion" value="APP-1" /></traits></test>\'',
            'report App.Gate \'<test name="App.Gate.Live" result="Skip" />\'',
        ].join("\n");
        const root = repository({ "suwgate.yml": "profiles: [dotnet]\n", "bin/dotnet": fakeDotnet });
        execFileSync("chmod", ["+x", "bin/dotnet"], { cwd: root });
        const command = line(step("dotnet-test").run, context(root, { profile: "dotnet" }));
        if (typeof command !== "string") throw new Error("no command");
        const env = { ...process.env, PATH: `${path.join(root, "bin")}:${process.env["PATH"] ?? ""}`, SUWGATE_RUN: root };
        const result = spawnSync("bash", ["-c", command, "suwgate", "--filter-class", "*"], { cwd: root, env, encoding: "utf8" });

        expect(result.stdout + result.stderr).not.toContain("ran 0 tests");
        expect(result.status).toBe(0);
        expect(readRun("xunit", path.join(root, "dotnet-test", "results"))).toEqual({ executed: 1, passed: ["APP-1:"] });
        expect(readdirSync(path.join(root, "dotnet-test", "results")).sort()).toEqual([
            "App.Gate.net10.0.xunit.xml",
            "App.Tests.net10.0.xunit.xml",
        ]);
    });
});

describe("database-up and compose", () => {
    it("start and resolve the compose stack only when there is a compose file", () => {
        const bare = context(repository({ "README.md": "" }));
        const composed = context(repository({ "compose.yaml": "services: {}" }));

        expect(line(step("database-up").run, bare)).toBeNull();
        expect(line(step("compose").run, bare)).toBeNull();
        expect(line(step("database-up").run, composed)).toContain("docker compose --profile db up -d --wait db");
        expect(line(step("compose").run, composed)).toBe("docker compose config --quiet && docker compose --profile db config --quiet");
    });

    it("start the repository's own database when dev.database.up names its command", () => {
        const own = context(
            repository({ "suwgate.yml": "profiles: [database]\ndev:\n  name: x\n  database:\n    up: scripts/db.sh up\n" }),
        );

        expect(line(step("database-up").run, own)).toContain("dev db up");
    });
});

const PASSED_PLAYWRIGHT = JSON.stringify({
    suites: [{ title: "a.e2e.ts", file: "a.e2e.ts", specs: [{ title: "works", tests: [{ status: "expected" }] }] }],
});

describe("e2e", () => {
    it("runs the web app's Playwright tests when it has e2e/playwright.config.ts", () => {
        const root = repository({ "Myapp.Web/e2e/playwright.config.ts": "" });
        const directories = { web: "Myapp.Web" };

        expect(line(step("e2e").run, context(root, { profile: "web", directories }))).toContain(
            'PLAYWRIGHT_JSON_OUTPUT_FILE="$run/playwright.json" pnpm exec playwright test -c e2e/playwright.config.ts "$@"\n',
        );
        expect(line(step("e2e").run, context(repository({}), { profile: "web" }))).toBeNull();
    });

    it("with a dev section, gives the tests a fresh database of this checkout first, then runs them with its variables", () => {
        const root = repository({
            "suwgate.yml": "profiles: [web, dotnet, database]\ndirectories:\n  web: Myapp.Web\ndev:\n  name: myapp\n",
            "compose.yaml": "services: {}\n",
            "Myapp.Web/e2e/playwright.config.ts": "",
            "bin/docker": '#!/usr/bin/env bash\necho "docker $*" >>"$CALLS"\n',
            "bin/pnpm": `#!/usr/bin/env bash\necho "pnpm $* $E2E_DATABASE $E2E_SERVER_PORT" >>"$CALLS"\n[ -z "\${PLAYWRIGHT_JSON_OUTPUT_FILE:-}" ] || echo '${PASSED_PLAYWRIGHT}' >"$PLAYWRIGHT_JSON_OUTPUT_FILE"\n`,
        });
        execFileSync("chmod", ["+x", "bin/docker", "bin/pnpm"], { cwd: root });
        const at = context(root, { profile: "web", directories: { web: "Myapp.Web" } });
        const command = line(step("e2e").run, at);
        if (typeof command !== "string") throw new Error("no command");
        const calls = path.join(root, "calls.log");
        const bin = `${path.join(root, "bin")}:${process.env["PATH"] ?? ""}`;
        const env = { ...process.env, PATH: bin, CALLS: calls, CI: "", E2E_DATABASE: "", E2E_SERVER_PORT: "" };
        execFileSync("bash", ["-c", command], { cwd: at.cwd, env, stdio: ["ignore", "ignore", "ignore"] });

        const log = readFileSync(calls, "utf8").trim().split("\n");
        expect(log[0]).toMatch(/^docker compose .* up -d --wait db$/);
        expect(log[1]).toMatch(
            /exec -T db psql .* -d postgres -c DROP DATABASE IF EXISTS myapp_e2e WITH \(FORCE\) -c CREATE DATABASE myapp_e2e$/,
        );
        expect(log[2]).toMatch(/^pnpm exec playwright test -c e2e\/playwright.config.ts myapp_e2e \d+$/);
        expect(existsSync(path.join(root, ".artifacts/logs"))).toBe(true);
    });

    it("starts the repository's own database, runs the before commands in the root and hands Playwright the step's arguments", () => {
        const root = repository({
            "suwgate.yml": [
                "profiles: [web, dotnet, database]",
                "directories:\n  web: Myapp.Web",
                "dev:",
                "  name: myapp",
                "  database:",
                '    up: echo "db up" >>"$CALLS"',
                '    psql: echo "db psql" >>"$CALLS"',
            ].join("\n"),
            "Myapp.Web/e2e/playwright.config.ts": "",
            "bin/pnpm": `#!/usr/bin/env bash\necho "pnpm $*" >>"$CALLS"\n[ -z "\${PLAYWRIGHT_JSON_OUTPUT_FILE:-}" ] || echo '${PASSED_PLAYWRIGHT}' >"$PLAYWRIGHT_JSON_OUTPUT_FILE"\n`,
        });
        execFileSync("chmod", ["+x", "bin/pnpm"], { cwd: root });
        const at = context(root, {
            profile: "web",
            directories: { web: "Myapp.Web" },
            settings: { e2e: { before: ['echo "before in $PWD" >>"$CALLS"'] } },
        });
        const command = line(step("e2e").run, at);
        if (typeof command !== "string") throw new Error("no command");
        const calls = path.join(root, "calls.log");
        const env = {
            ...process.env,
            PATH: `${path.join(root, "bin")}:${process.env["PATH"] ?? ""}`,
            CALLS: calls,
            CI: "",
            E2E_DATABASE: "",
        };
        execFileSync("bash", ["-c", command, "suwgate", "--headed", "-g", "two words"], { cwd: at.cwd, env, stdio: "ignore" });

        expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
            "db up",
            "db psql -q -d postgres -c DROP DATABASE IF EXISTS myapp_e2e WITH (FORCE) -c CREATE DATABASE myapp_e2e",
            `before in ${root}`,
            "pnpm exec playwright test -c e2e/playwright.config.ts --headed -g two words",
        ]);
    });

    it("refuses to recreate a database whose name lacks e2e", () => {
        const root = repository({ "suwgate.yml": "dev:\n  name: myapp\n", "e2e/playwright.config.ts": "" });
        const command = line(step("e2e").run, context(root, { profile: "web" }));
        if (typeof command !== "string") throw new Error("no command");

        const run = spawnSync("bash", ["-c", command], { cwd: root, env: { ...process.env, E2E_DATABASE: "myapp" }, encoding: "utf8" });

        expect(run.status).toBe(2);
        expect(run.stderr).toContain('E2E_DATABASE is "myapp": the e2e step drops and recreates it');
    });
});

describe("the contract steps", () => {
    const server = '<Project><ItemGroup><PackageReference Include="Microsoft.Extensions.ApiDescription.Server" /></ItemGroup></Project>';

    it("return nothing for a repository without a contract", () => {
        const root = repository({ "Myapp.Server/Myapp.Server.csproj": server });

        expect(apiContract(context(root))).toBeNull();
        expect(line(step("api-version").run, context(root))).toBeNull();
        expect(contractPins(context(root))).toBeNull();
    });

    it("regenerate the contract and the web app's types from the server and compare them with the committed ones", () => {
        const root = repository({
            "Myapp.Server/Myapp.Server.csproj": server,
            "contract/openapi.json": "{}",
            "Myapp.Web/src/api/openapi.d.ts": "",
        });
        const command = apiContract(context(root, { profile: "dotnet", profiles: ["web", "dotnet"], directories: { web: "Myapp.Web" } }));

        expect(command).toContain(
            "dotnet build 'Myapp.Server/Myapp.Server.csproj' --nologo -v quiet -p:OpenApiGenerateDocumentsOnBuild=true",
        );
        expect(command).toContain(`diff -q "$work"/'Myapp.Server.json' contract/openapi.json`);
        expect(command).toContain(`(cd '${root}/Myapp.Web' && pnpm exec openapi-typescript`);
        expect(command).toContain("stale+=('Myapp.Web/src/api/openapi.d.ts')");
        expect(apiContract(context(root, { profile: "dotnet", profiles: ["dotnet"] }))).not.toContain("openapi-typescript");
    });

    it("say which project should write the contract when none or several do", () => {
        expect(apiContract(context(repository({ "contract/openapi.json": "{}" })))).toContain(
            "reference Microsoft.Extensions.ApiDescription.Server in the server",
        );
        expect(apiContract(context(repository({ "contract/openapi.json": "{}", "A/A.csproj": server, "B/B.csproj": server })))).toContain(
            "more than one project",
        );
    });

    it("compare the contract with master through oasdiff", () => {
        expect(line(step("api-version").run, context(repository({ "contract/openapi.json": "{}" })))).toContain(
            'oasdiff breaking "$work/base.json" contract/openapi.json --fail-on ERR',
        );
    });

    it("look for the contract where settings.contract of api-contract says, and refuse every break with breaking: never", () => {
        const root = repository({ "Myapp.Server/Myapp.Server.csproj": server, "Myapp.Server/openapi.json": "{}" });
        const contract = { "api-contract": { contract: "Myapp.Server/openapi.json" } };
        const major = line(step("api-version").run, context(root, { settings: contract }));
        const never = line(step("api-version").run, context(root, { settings: { ...contract, "api-version": { breaking: "never" } } }));

        expect(apiContract(context(root, { settings: contract }))).toContain(
            "diff -q \"$work\"/'Myapp.Server.json' Myapp.Server/openapi.json",
        );
        expect(apiContract(context(root))).toBeNull();
        expect(major).toContain("raise the major version in Myapp.Server/package.json");
        expect(never).toContain("this repository allows no break (api-version breaking: never in suwgate.yml)");
        expect(never).not.toContain("as the new major version");
    });

    const KEY = "contract";
    it.each([
        [`[Trait("${KEY}", "rabaty@v2")]`, true],
        [`it("${KEY} rabaty@2.1.0: the cart shows the discount", () => {});`, true],
        [`[Trait("${KEY}", "rabaty@latest")]`, false],
        [`test('${KEY} rabaty@next: x', () => {});`, false],
    ])("list the contract pins and fail on one without a version: %s", (text, valid) => {
        const command = contractPins(context(repository({ "Myapp.Web/src/cart.test.ts": text })));

        expect(command).toContain("Myapp.Web/src/cart.test.ts:1");
        expect(command?.endsWith("; exit 1")).toBe(!valid);
    });
});

describe("criteria", () => {
    function tool(): { cache: string; pin: { repository: string; commit: string; sha256: string } } {
        const cache = mkdtempSync(path.join(tmpdir(), "suwgate-cache-"));
        folders.push(cache);
        mkdirSync(path.join(cache, "suwagent"));
        writeFileSync(path.join(cache, "suwagent", "vdoc-abc.py"), "print('vdoc')");
        vi.stubEnv("XDG_CACHE_HOME", cache);
        return { cache, pin: { repository: "x/y", commit: "abc", sha256: createHash("sha256").update("print('vdoc')").digest("hex") } };
    }

    it("gives every profile its default kinds, in its directory, after the repository's own from criteria.json", () => {
        const root = repository({ "Myapp.Server.Tests/Myapp.Server.Tests.csproj": '<PackageReference Include="xunit.v3" />' });
        const config = criteriaConfig(context(root, { profiles: ["web", "dotnet"], directories: { web: "Myapp.Web" } }), {
            kinds: [{ kind: "smoke test", paths: ["scripts/smoke.sh"], how: "# <id>" }],
        });

        expect(config.specs).toBe("docs/visual/spec");
        expect(config.kinds.map((kind) => kind.kind)).toEqual([
            "smoke test",
            "e2e test (playwright)",
            "web test (vitest)",
            "lint (eslint)",
            "type check (tsc)",
            "test (xunit)",
            "lint (.NET analyzer)",
            "banned API",
            "build rule",
        ]);
        expect(config.kinds.find((kind) => kind.kind === "test (xunit)")?.paths).toEqual(["Myapp.Server.Tests/**/*.cs"]);
        expect(config.kinds.find((kind) => kind.kind === "web test (vitest)")?.paths).toEqual([
            "Myapp.Web/src/**/*.test.ts",
            "Myapp.Web/src/**/*.test.tsx",
        ]);
    });

    it("runs the pinned vdoc.py over the repository with the kinds it wrote", () => {
        const { cache, pin } = tool();
        const root = repository({ "criteria.json": '{ "specs": "specs" }' });

        const command = criteria(pin)(context(root, { profiles: ["library"] }));

        expect(command).toContain(
            `python3 '${path.join(cache, "suwagent", "vdoc-abc.py")}' criteria --root '${root}' --config '${cache}/suwgate/`,
        );
        expect(command).toContain('"specs": "specs"');
        expect(command).toContain('"kind": "story test (vitest, Chromium)"');
    });

    it("fails, saying why, on a tool that does not match its pin or a criteria.json that is not JSON", () => {
        const { pin } = tool();

        expect(criteria({ ...pin, sha256: "0" })(context(repository({})))).toContain("does not match the SHA-256 suwgate pins");
        expect(criteria(pin)(context(repository({ "criteria.json": "{" })))).toContain("criteria.json is not valid JSON");
    });

    it("is SKIP when the pinned tool cannot be downloaded", () => {
        tool();
        vi.stubEnv("PATH", path.dirname(execFileSync("bash", ["-c", "command -v python3"], { encoding: "utf8" }).trim()));

        expect(criteria({ repository: "x/y", commit: "missing", sha256: "0" })(context(repository({})))).toEqual({
            skip: expect.stringMatching(/cannot be downloaded|curl not installed/) as unknown,
        });
    });
});
