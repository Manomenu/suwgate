import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Step, StepContext } from "../gate/contract.ts";
import { CRITERIA_FILE, criteriaConfig } from "./criteria.ts";
import { readRun, type ReportFormat, type TestRun } from "./reports.ts";
import { quoted, read, tracked, verdictCommand } from "./shell.ts";

interface TestSource {
    step: string;
    format: ReportFormat;
    report: string;
    patterns: string[];
    skipped?: string;
}

export interface CriteriaRanInput {
    root: string;
    run: string;
    specs: string[];
    sources: TestSource[];
}

const REPORTED: Readonly<Record<string, { step: string; format: ReportFormat }>> = {
    "test (xunit)": { step: "dotnet-test", format: "xunit" },
    "web test (vitest)": { step: "unit-tests", format: "vitest" },
    "unit test (vitest)": { step: "unit-tests", format: "vitest" },
    "story test (vitest, Chromium)": { step: "stories", format: "vitest" },
    "e2e test (playwright)": { step: "e2e", format: "playwright" },
    "visual test (playwright)": { step: "visual", format: "playwright" },
    "consumer test (playwright)": { step: "consumer-app", format: "playwright" },
};

const REPORT_FILE: Readonly<Record<ReportFormat, string>> = { vitest: "vitest.json", playwright: "playwright.json", xunit: "results" };

const ACCEPTANCE = /data-role="acceptance"[\s\S]*?(?=data-role="|$)/g;

const CODE = /<code>([A-Za-z][\w.]*(?:-[\w.]+)*-\d+)<\/code>/g;

export function criterionIds(spec: string): string[] {
    return [...new Set([...spec.matchAll(ACCEPTANCE)].flatMap((section) => [...section[0].matchAll(CODE)].map((code) => code[1] ?? "")))];
}

export function names(text: string, id: string, format: ReportFormat): boolean {
    if (format === "xunit") return new RegExp(`Trait\\(\\s*"criterion"\\s*,\\s*"${id.replace(/[.]/g, "\\.")}"\\s*\\)`).test(text);
    return ['"', "'", "`"].some((quote) => text.includes(`${quote}${id}:`));
}

function proven(passed: readonly string[], id: string): boolean {
    return passed.some((title) => title.startsWith(`${id}:`) || title.includes(` ${id}:`));
}

function listed(root: string, patterns: readonly string[]): string[] {
    if (patterns.length === 0) return [];
    try {
        return execFileSync(
            "git",
            ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...patterns.map((p) => `:(glob)${p}`)],
            {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            },
        )
            .split("\0")
            .filter((file) => file !== "");
    } catch {
        return [];
    }
}

export function criteriaRan(input: CriteriaRanInput): string[] {
    const ids = [...new Set(input.specs.flatMap((spec) => criterionIds(readFileSync(path.join(input.root, spec), "utf8"))))];
    const runs = new Map<string, TestRun | null>(
        input.sources.map((source) => [
            source.step,
            source.skipped === undefined ? readRun(source.format, path.join(input.run, source.report)) : null,
        ]),
    );
    const texts = input.sources.map((source) => ({
        source,
        files: listed(input.root, source.patterns).map((file) => ({ file, text: readFileSync(path.join(input.root, file), "utf8") })),
    }));
    return ids.flatMap((id) => {
        const naming = texts.flatMap(({ source, files }) =>
            files.filter((file) => names(file.text, id, source.format)).map((file) => ({ source, file: file.file })),
        );
        const checked = naming.filter((entry) => entry.source.skipped === undefined);
        if (checked.length === 0) return [];
        if (checked.some((entry) => proven(runs.get(entry.source.step)?.passed ?? [], id))) return [];
        const unreported = [...new Set(checked.filter((entry) => runs.get(entry.source.step) === null).map((entry) => entry.source.step))];
        const why = unreported.length > 0 ? `${unreported.join(", ")} wrote no report` : "skipped, filtered out, or failed";
        return [
            `${id}: named by ${checked.map((entry) => `${entry.file} (${entry.source.step})`).join(", ")}, but no test naming it ran and passed in this gate run (${why}): make that test run and pass, or skip its step in suwgate.yml (steps.skip) with a reason`,
        ];
    });
}

function specsFolder(context: StepContext): string {
    const text = read({ ...context, cwd: context.root }, CRITERIA_FILE);
    try {
        const parsed = text === null ? {} : (JSON.parse(text) as { specs?: unknown });
        return typeof parsed.specs === "string" ? parsed.specs : "docs/visual/spec";
    } catch {
        return "docs/visual/spec";
    }
}

export function criteriaRanInput(context: StepContext): Omit<CriteriaRanInput, "run"> | null {
    const root = { ...context, cwd: context.root };
    const specs = tracked(root, [`${specsFolder(context)}/*.html`]);
    if (specs.length === 0) return null;
    const sources = criteriaConfig(context, {}).kinds.flatMap((kind) => {
        const reported = REPORTED[kind.kind];
        if (reported === undefined) return [];
        return [
            {
                ...reported,
                report: path.posix.join(reported.step, REPORT_FILE[reported.format]),
                patterns: kind.paths,
                ...(context.skippedSteps.includes(reported.step) ? { skipped: "skipped in suwgate.yml" } : {}),
            },
        ];
    });
    return { root: context.root, specs, sources };
}

export const criteriaRanStep: Step = {
    id: "criteria-ran",
    title: "every acceptance criterion a test names ran and passed in this gate run (the test tools' reports)",
    after: ["unit-tests", "stories", "e2e", "visual", "consumer-app", "dotnet-test"],
    run: (context) => {
        const input = criteriaRanInput(context);
        return input === null ? null : verdictCommand(`criteria "\${SUWGATE_RUN:-/no-run-folder}" ${quoted(JSON.stringify(input))}`);
    },
    limitSeconds: 60,
};
