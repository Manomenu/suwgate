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

export function files(location: string, extension: string): string[] {
    if (!existsSync(location)) return [];
    return readdirSync(location)
        .filter((file) => file.endsWith(extension))
        .map((file) => path.join(location, file));
}

export function readRun(format: ReportFormat, location: string): TestRun | null {
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
