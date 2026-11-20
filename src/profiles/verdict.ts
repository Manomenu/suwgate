import { readFileSync } from "node:fs";

import { criteriaRan, type CriteriaRanInput } from "./criteriaRan.ts";
import { files, readRun, type ReportFormat } from "./reports.ts";

const STRICT_FAMILY = [
    "noImplicitAny",
    "strictNullChecks",
    "strictFunctionTypes",
    "strictBindCallApply",
    "strictPropertyInitialization",
    "strictBuiltinIteratorReturn",
    "noImplicitThis",
    "useUnknownInCatchVariables",
    "alwaysStrict",
];

export function testsVerdict(format: ReportFormat, location: string, tool: string): string | null {
    const run = readRun(format, location);
    if (run === null) return `${tool} wrote no report, so suwgate cannot tell that any test ran: run it again and look at its output above`;
    if (run.executed > 0) return null;
    return `${tool} ran 0 tests (every test skipped or filtered out, or none found), and a gate that ran nothing proves nothing: add a test that runs, or skip the step in suwgate.yml (steps.skip) with a reason`;
}

function missingGuards(evidence: string, required: readonly string[]): string[] {
    const ran = new Set(evidence.split("\n").map((line) => line.split("\t")[0] ?? ""));
    return required.filter((guard) => !ran.has(guard));
}

export function guardsVerdict(directory: string, required: readonly string[]): string | null {
    const evidence = files(directory, ".tsv")
        .map((file) => readFileSync(file, "utf8"))
        .join("\n");
    const missing = missingGuards(evidence, required);
    if (missing.length === 0) return null;
    return [
        `${missing.length} .NET guard(s) of the repository's profiles did not run in this gate run: ${missing.join(", ")}.`,
        "Call SuwgateGuards.VerifyAll(new GuardInputs { ... }) from one xUnit test in a test project that references Suwgate.Architecture",
        "(the Suwgate.Architecture README shows the test; pass new DatabaseProfile() with the database profile), and do not skip that test;",
        "a guard that does not apply to this repository is skipped in suwgate.yml (guards.skip) with a reason.",
    ].join("\n");
}

function strictOptions(preset: Readonly<Record<string, unknown>>): string[] {
    return Object.keys(preset).filter((option) => /^(strict|no|exact)/.test(option) && option !== "noEmit");
}

export function tsconfigVerdict(file: string, shown: string, preset: Readonly<Record<string, unknown>>): string | null {
    const options = (JSON.parse(shown) as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
    const off = [
        ...strictOptions(preset).filter((option) => options[option] !== preset[option]),
        ...(preset["strict"] === true ? STRICT_FAMILY.filter((option) => options[option] === false) : []),
    ];
    if (off.length === 0) return null;
    return `${file}: tsc --showConfig shows ${off.map((option) => `${option}: ${JSON.stringify(options[option] ?? "unset")}`).join(", ")}; the strict preset of suwgate needs them on: extend @maniumek/suwgate/tsconfig/strict (or browser, node) and delete the override`;
}

export function eslintVerdict(file: string, printed: string, rules: readonly string[]): string | null {
    const config = JSON.parse(printed) as { rules?: Record<string, unknown> };
    const severity = (rule: string): unknown => {
        const setting = config.rules?.[rule];
        return Array.isArray(setting) ? (setting[0] as unknown) : setting;
    };
    const off = rules.filter((rule) => severity(rule) !== 2 && severity(rule) !== "error");
    if (off.length === 0) return null;
    return `${file}: eslint --print-config shows ${off.map((rule) => `${rule} ${JSON.stringify(severity(rule) ?? "off")}`).join(", ")}; it must be an error for every source file: build eslint.config.js on strict() or app() of @maniumek/suwgate/eslint and delete what turns it off`;
}

const STRICT_PRESET = new URL("./presets/tsconfig/strict.json", import.meta.url);

function presetOptions(): Record<string, unknown> {
    return (JSON.parse(readFileSync(STRICT_PRESET, "utf8")) as { compilerOptions: Record<string, unknown> }).compilerOptions;
}

function stdin(): string {
    try {
        return readFileSync(0, "utf8");
    } catch {
        return "";
    }
}

function format(value: string | undefined): ReportFormat | null {
    return value === "vitest" || value === "playwright" || value === "xunit" ? value : null;
}

function judged(argv: readonly string[]): string | null | undefined {
    const [command, first = "", ...rest] = argv;
    switch (command) {
        case "tests": {
            const kind = format(first);
            const [location, tool] = rest;
            return kind === null || location === undefined || tool === undefined ? undefined : testsVerdict(kind, location, tool);
        }
        case "guards":
            return guardsVerdict(first, rest);
        case "tsconfig":
            return tsconfigVerdict(first, stdin(), presetOptions());
        case "eslint":
            return eslintVerdict(first, stdin(), rest);
        case "criteria": {
            const [input] = rest;
            if (input === undefined) return undefined;
            const problems = criteriaRan({ ...(JSON.parse(input) as Omit<CriteriaRanInput, "run">), run: first });
            return problems.length === 0 ? null : problems.join("\n");
        }
        default:
            return undefined;
    }
}

export function verdict(argv: readonly string[]): { exitCode: number; text: string } {
    let problem: string | null | undefined;
    try {
        problem = judged(argv);
    } catch (error) {
        problem = `suwgate verdict ${argv.join(" ")}: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (problem === undefined) {
        return {
            exitCode: 2,
            text: "usage: suwgate verdict tests <vitest|playwright|xunit> <report> <tool> | guards <evidence-dir> <guard>... | tsconfig <file> | eslint <file> <rule>... | criteria <run-dir> <input-json>",
        };
    }
    return problem === null ? { exitCode: 0, text: "" } : { exitCode: 1, text: problem };
}
