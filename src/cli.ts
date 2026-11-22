#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { check, step } from "./gate/check.ts";
import type { ApiDiscovery } from "./dev/apiTypes.ts";
import { dev, realEnvironment } from "./dev/index.ts";
import { loadConfig, type Catalog } from "./gate/config.ts";
import { PROFILES } from "./gate/contract.ts";
import { repositoryRoot } from "./gate/repository.ts";
import { guards, SHARED_RULES, writeSharedRules } from "./guards/index.ts";
import { discoverApiIn, dotnetGuards, stepsFor, verdict } from "./profiles/index.ts";
import { guardEdit, type EditHookProject, type EditHookSettings } from "./session/guardEdit.ts";
import { preCommit, runTool } from "./session/preCommit.ts";
import { stop } from "./session/stop.ts";

const USAGE = `usage: suwgate check [--quick] [--verbose] | suwgate step [<id> [--only] [--verbose] [-- <args>]] | suwgate hook <guard-edit|stop|pre-commit> | suwgate dev <command> | suwgate agents-shared | suwgate --help | --version
  suwgate check            every step of the repository's profiles (suwgate.yml) and the repository guards
  suwgate check --quick    the guards, and the quick steps only for what changed since master; has a time budget
                           (SUWGATE_QUICK_LIMIT seconds, default 20) because the Stop hook runs it after every turn
  --verbose                list every step with its time, also when all pass, and the whole output of a failed step
  suwgate step             the steps of this repository, with their titles and the tool that takes -- arguments
  suwgate step <id>        one step and the steps it needs (after, transitively), with the same report; not a gate
                           pass: the Stop hook does not count it. --only: that step alone. After --, arguments for the
                           step's tool: suwgate step e2e -- --headed -g notes (Playwright), suwgate step unit-tests --
                           -t "name" (Vitest), suwgate step dotnet-test -- --filter-method "*Notes*" (xUnit v3)
  suwgate hook guard-edit  Claude Code PreToolUse hook: refuses an agent's edit of the gate and of generated files
                           (ALLOW_GATE_EDIT=1 lifts the gate part for one session); only files of its own project
                           (CLAUDE_PROJECT_DIR, else the git checkout it runs in), with the lists of its profiles
  suwgate hook stop        Claude Code Stop hook: runs the quick gate unless nothing changed since it last passed
  suwgate hook pre-commit  git pre-commit hook: gitleaks on the staged changes, then the quick gate
  suwgate dev <db|logs|smoke|server|tmux|sibling|api-types|slow-tests|checkout-env>
                           the local stack of the repository (the dev section of suwgate.yml), and the images of the
                           sibling repositories it runs, rebuilt from their checkouts when stale, the API contract and types regenerated
                           from the server, and a report of the slowest .NET tests; suwgate dev --help
  suwgate agents-shared    writes AGENTS.shared.md, the rules every repository shares, as this suwgate ships it, into the
                           repository root (the agents-shared guard fails until the copy is current)
  suwgate verdict <tests|guards|tsconfig|eslint> ...
                           what the steps call after their tool: did tests run, did the .NET guards run (evidence),
                           are the strict compiler options and the eslint rules in effect
Every step has a ceiling (SUWGATE_STEP_LIMIT seconds overrides them all). A step whose tool is missing is SKIP,
and a SKIP fails the gate when CI is set. Exit code: 0 green, 1 red, 2 a usage or suwgate.yml problem.`;

const catalog: Catalog = { guards, dotnetGuards, stepsFor };

function version(): string {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    return manifest.version;
}

function editHookProject(root: string): EditHookProject {
    const loaded = loadConfig(root, catalog);
    if (!("config" in loaded)) return { root, profiles: PROFILES, settings: {} };
    const settings = loaded.config.settings["hooks"] as EditHookSettings | undefined;
    return { root, profiles: loaded.config.profiles, settings: settings ?? {} };
}

function discoverApi(cwd: string): ApiDiscovery {
    const root = repositoryRoot(cwd) ?? cwd;
    const loaded = loadConfig(root, catalog);
    if (!("config" in loaded)) return { problem: `suwgate.yml is not valid: ${loaded.problems.join("; ")}` };
    const { profiles, directories, configure } = loaded.config;
    const layout = discoverApiIn({ root, profiles, directories, contractSettings: configure["api-contract"]?.settings });
    return "problem" in layout ? layout : { root, layout };
}

function readInput(): string {
    try {
        return readFileSync(0, "utf8");
    } catch {
        return "";
    }
}

async function runStep(argv: readonly string[]): Promise<number> {
    const separator = argv.indexOf("--");
    const own = separator === -1 ? argv : argv.slice(0, separator);
    const args = separator === -1 ? [] : argv.slice(separator + 1);
    if (own.includes("--help")) {
        console.log(USAGE);
        return 0;
    }
    const { values, positionals } = parseArgs({
        args: [...own],
        allowPositionals: true,
        strict: true,
        options: { only: { type: "boolean" }, verbose: { type: "boolean" } },
    });
    if (positionals.length > 1) throw new Error(`suwgate step takes one step id, not ${positionals.join(" ")}`);
    const result = await step({
        cwd: process.cwd(),
        id: positionals[0],
        only: values.only === true,
        args,
        verbose: values.verbose === true,
        env: process.env,
        catalog,
    });
    (result.exitCode === 0 ? console.log : console.error)(result.text);
    return result.exitCode;
}

async function main(argv: readonly string[]): Promise<number> {
    if (argv[0] === "dev") return dev(argv.slice(1), realEnvironment(discoverApi));
    if (argv[0] === "step") return runStep(argv.slice(1));
    if (argv[0] === "verdict") {
        const result = verdict(argv.slice(1));
        if (result.text !== "") console.error(result.text);
        return result.exitCode;
    }
    const { values, positionals } = parseArgs({
        args: [...argv],
        allowPositionals: true,
        strict: true,
        options: { quick: { type: "boolean" }, verbose: { type: "boolean" }, help: { type: "boolean" }, version: { type: "boolean" } },
    });
    const [command, hook, ...rest] = positionals;
    if (values.help === true) {
        console.log(USAGE);
        return 0;
    }
    if (values.version === true) {
        console.log(version());
        return 0;
    }
    const runCheck = (cwd: string, quick: boolean, verbose: boolean) => check({ cwd, quick, verbose, env: process.env, catalog });
    if (command === "check" && hook === undefined) {
        const result = await runCheck(process.cwd(), values.quick === true, values.verbose === true);
        (result.exitCode === 0 ? console.log : console.error)(result.text);
        return result.exitCode;
    }
    if (command === "agents-shared" && hook === undefined) {
        const root = repositoryRoot(process.cwd()) ?? process.cwd();
        const result = writeSharedRules(root);
        console.log(
            result === "written" ? `wrote ${SHARED_RULES} of suwgate ${version()}: commit it` : `${SHARED_RULES} is already current`,
        );
        return 0;
    }
    if (command === "hook" && rest.length === 0 && hook === "pre-commit") {
        const root = repositoryRoot(process.cwd()) ?? process.cwd();
        const verdict = await preCommit(root, runTool, () => runCheck(root, true, false));
        if (verdict.message !== "") console.error(verdict.message);
        return verdict.exitCode;
    }
    if (command === "hook" && rest.length === 0 && (hook === "guard-edit" || hook === "stop")) {
        const root = process.env["CLAUDE_PROJECT_DIR"] ?? repositoryRoot(process.cwd()) ?? process.cwd();
        const verdict =
            hook === "guard-edit"
                ? guardEdit(readInput(), editHookProject(root), process.env["ALLOW_GATE_EDIT"] === "1")
                : await stop(readInput(), root, () => runCheck(root, true, false));
        if (verdict.message !== "") console.error(verdict.message);
        return verdict.exitCode;
    }
    console.error(USAGE);
    return 2;
}

try {
    process.exitCode = await main(process.argv.slice(2));
} catch (error) {
    console.error(`suwgate: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exitCode = 2;
}
