import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type ReportFormat = "vitest" | "playwright" | "xunit";

export interface TestRun {
    executed: number;
    passed: string[];
}

interface VitestAssertion {
    fullName?: string;
    status?: string;
}

interface VitestReport {
    testResults?: { assertionResults?: VitestAssertion[] }[];
}

interface PlaywrightSpec {
    title?: string;
    tests?: { status?: string }[];
}

interface PlaywrightSuite {
    title?: string;
    file?: string;
    specs?: PlaywrightSpec[];
    suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
    suites?: PlaywrightSuite[];
}

const XUNIT_TEST = /<test\b([^>]*?)(?:\/>|>([\s\S]*?)<\/test>)/g;

const CRITERION_TRAIT = /<trait\s+name="criterion"\s+value="([^"]*)"/g;

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

export function vitestRun(report: VitestReport): TestRun {
    const assertions = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
    return {
        executed: assertions.filter((assertion) => assertion.status === "passed" || assertion.status === "failed").length,
        passed: assertions.filter((assertion) => assertion.status === "passed").map((assertion) => assertion.fullName ?? ""),
    };
}

function specsOf(suite: PlaywrightSuite, titles: readonly string[]): { title: string; statuses: string[] }[] {
    const own = suite.file === undefined || suite.title !== suite.file ? [...titles, suite.title ?? ""] : titles;
    return [
        ...(suite.specs ?? []).map((spec) => ({
            title: [...own, spec.title ?? ""].filter((title) => title !== "").join(" "),
            statuses: (spec.tests ?? []).map((test) => test.status ?? ""),
        })),
        ...(suite.suites ?? []).flatMap((inner) => specsOf(inner, own)),
    ];
}

export function playwrightRun(report: PlaywrightReport): TestRun {
    const specs = (report.suites ?? []).flatMap((suite) => specsOf(suite, []));
    return {
        executed: specs.filter((spec) => spec.statuses.some((status) => status !== "skipped")).length,
        passed: specs
            .filter((spec) => spec.statuses.length > 0 && spec.statuses.every((status) => status === "expected" || status === "flaky"))
            .map((spec) => spec.title),
    };
}

export function xunitRun(xml: string): TestRun {
    const tests = [...xml.matchAll(XUNIT_TEST)].map((match) => ({
        result: /\bresult="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? "",
        criteria: [...(match[2] ?? "").matchAll(CRITERION_TRAIT)].map((trait) => trait[1] ?? ""),
    }));
    return {
        executed: tests.filter((test) => test.result === "Pass" || test.result === "Fail").length,
        passed: tests.filter((test) => test.result === "Pass").flatMap((test) => test.criteria.map((id) => `${id}:`)),
    };
}

function files(location: string, extension: string): string[] {
    if (!existsSync(location)) return [];
    return readdirSync(location)
        .filter((file) => file.endsWith(extension))
        .map((file) => path.join(location, file));
}

function readRun(format: ReportFormat, location: string): TestRun | null {
    if (format === "xunit") {
        const reports = files(location, ".xml");
        if (reports.length === 0) return null;
        const runs = reports.map((report) => xunitRun(readFileSync(report, "utf8")));
        return { executed: runs.reduce((sum, run) => sum + run.executed, 0), passed: runs.flatMap((run) => run.passed) };
    }
    if (!existsSync(location)) return null;
    const report = JSON.parse(readFileSync(location, "utf8")) as object;
    return format === "vitest" ? vitestRun(report) : playwrightRun(report);
}

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
            text: "usage: suwgate verdict tests <vitest|playwright|xunit> <report> <tool> | guards <evidence-dir> <guard>... | tsconfig <file> | eslint <file> <rule>...",
        };
    }
    return problem === null ? { exitCode: 0, text: "" } : { exitCode: 1, text: problem };
}
