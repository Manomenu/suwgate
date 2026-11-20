import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Step, StepContext } from "../gate/contract.ts";
import { CRITERIA_FILE, criteriaConfig } from "./criteria.ts";
import { excludedTraits } from "./dotnet.ts";
import { readRun, type ReportFormat, type TestRun } from "./reports.ts";
import { quoted, read, tracked, verdictCommand } from "./shell.ts";

interface TestSource {
    step: string;
    format: ReportFormat;
    report: string;
    patterns: string[];
    skipped?: string;
    excludeTraits?: string[];
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

const ATTRIBUTE = /^\s*\[/;

const TYPE = /\b(class|record|struct)\s+\w+/;

function attributesAround(lines: readonly string[], index: number): string {
    let first = index;
    while (first > 0 && ATTRIBUTE.test(lines[first - 1] ?? "")) first--;
    let last = index;
    while (last + 1 < lines.length && ATTRIBUTE.test(lines[last + 1] ?? "")) last++;
    return lines.slice(first, last + 1).join("\n");
}

function escaped(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTrait(attributes: string, trait: string): boolean {
    const [name = "", value = ""] = trait.split("=");
    return new RegExp(`Trait\\(\\s*"${escaped(name)}"\\s*,\\s*"${escaped(value)}"\\s*\\)`).test(attributes);
}

function typeAttributes(lines: readonly string[], index: number): string {
    const typeLine = lines.slice(0, index).findLastIndex((line) => TYPE.test(line));
    return typeLine > 0 && ATTRIBUTE.test(lines[typeLine - 1] ?? "") ? attributesAround(lines, typeLine - 1) : "";
}

function outsideTheGate(text: string, id: string, traits: readonly string[]): boolean {
    if (traits.length === 0) return false;
    const lines = text.split("\n");
    const naming = lines.flatMap((line, index) => (names(line, id, "xunit") ? [index] : []));
    return (
        naming.length > 0 &&
        naming.every((index) => {
            const attributes = `${attributesAround(lines, index)}\n${typeAttributes(lines, index)}`;
            return traits.some((trait) => hasTrait(attributes, trait));
        })
    );
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
            files
                .filter((file) => names(file.text, id, source.format))
                .map((file) => ({ source, file: file.file, outside: outsideTheGate(file.text, id, source.excludeTraits ?? []) })),
        );
        const checked = naming.filter((entry) => entry.source.skipped === undefined);
        if (checked.length === 0) return [];
        if (checked.every((entry) => entry.outside)) {
            const traits = [...new Set(checked.flatMap((entry) => entry.source.excludeTraits ?? []))].join(", ");
            return [
                `${id}: named only by tests outside the gate (${traits}, excludeTraits of dotnet-test in suwgate.yml): ${checked.map((entry) => entry.file).join(", ")}. The gate never runs them, so nothing in it proves the criterion: add a test the gate runs that names it, with a stand-in for the outside service (a fake model or server), and keep the outside test for the real one`,
            ];
        }
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
                ...(reported.format === "xunit" && excludedTraits(context).length > 0 ? { excludeTraits: excludedTraits(context) } : {}),
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
