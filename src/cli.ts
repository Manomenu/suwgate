#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { check } from "./gate/check.ts";
import { dev } from "./dev/index.ts";
import { loadConfig, type Catalog } from "./gate/config.ts";
import { PROFILES } from "./gate/contract.ts";
import { repositoryRoot } from "./gate/repository.ts";
import { guards } from "./guards/index.ts";
import { dotnetGuards, stepsFor, verdict } from "./profiles/index.ts";
import { guardEdit, type EditHookProject, type EditHookSettings } from "./session/guardEdit.ts";
import { preCommit, runTool } from "./session/preCommit.ts";
import { stop } from "./session/stop.ts";

const USAGE = `usage: suwgate check [--quick] [--verbose] | suwgate hook <guard-edit|stop|pre-commit> | suwgate dev <command> | suwgate --help | --version
  suwgate check            every step of the repository's profiles (suwgate.yml) and the repository guards
  suwgate check --quick    the guards, and the quick steps only for what changed since master; has a time budget
                           (SUWGATE_QUICK_LIMIT seconds, default 20) because the Stop hook runs it after every turn
  --verbose                list every step with its time, also when all pass
  suwgate hook guard-edit  Claude Code PreToolUse hook: refuses an agent's edit of the gate and of generated files
                           (ALLOW_GATE_EDIT=1 lifts the gate part for one session); only files of its own project
                           (CLAUDE_PROJECT_DIR, else the git checkout it runs in), with the lists of its profiles
  suwgate hook stop        Claude Code Stop hook: runs the quick gate unless nothing changed since it last passed
  suwgate hook pre-commit  git pre-commit hook: gitleaks on the staged changes, then the quick gate
  suwgate dev <db|logs|smoke|server|tmux|checkout-env>
                           the local stack of the repository (the dev section of suwgate.yml); suwgate dev --help
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

function readInput(): string {
    try {
        return readFileSync(0, "utf8");
    } catch {
        return "";
    }
}

async function main(argv: readonly string[]): Promise<number> {
    if (argv[0] === "dev") return dev(argv.slice(1));
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
