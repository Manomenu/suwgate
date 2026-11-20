import type { StepResult } from "./runner.ts";

const FAILURE_LINES = 25;

export interface ReportInput {
    results: readonly StepResult[];
    command: string;
    totalSeconds: number;
    quickLimit: number | null;
    ci: boolean;
    exceptions: number;
    verbose: boolean;
}

export interface Report {
    text: string;
    passed: boolean;
}

function row(status: string, seconds: number | null, title: string, note = ""): string {
    return `  ${status.padEnd(4)} ${seconds === null ? "     " : `${String(seconds).padStart(4)}s`}  ${title}${note === "" ? "" : ` — ${note}`}`;
}

function tail(log: string): string {
    return log.trimEnd().split("\n").slice(-FAILURE_LINES).join("\n");
}

export function report(input: ReportInput): Report {
    const failures: string[] = [];
    const rows: string[] = [];
    const notVerified: string[] = [];
    const skippedByConfig: string[] = [];
    let passedCount = 0;
    let failed = false;
    for (const result of input.results) {
        const { step } = result;
        if (result.status === "skip") {
            if (step.skipped?.byConfig === true) {
                skippedByConfig.push(step.id);
                rows.push(row("SKIP", null, step.title, `skipped in suwgate.yml: ${result.log}`));
            } else if (input.ci) {
                failed = true;
                rows.push(row("FAIL", null, step.title, `${result.log} (CI: a skipped step fails)`));
            } else {
                notVerified.push(step.id);
                rows.push(row("SKIP", null, step.title, result.log));
            }
        } else if (result.status === "fail") {
            failed = true;
            rows.push(row("FAIL", result.seconds, step.title));
            failures.push(
                `==================== failed: ${step.title} (last ${FAILURE_LINES} lines) ====================\n${tail(result.log)}`,
            );
        } else {
            passedCount++;
            if (input.verbose) rows.push(row("PASS", result.seconds, step.title));
        }
    }
    if (input.quickLimit !== null && input.totalSeconds > input.quickLimit) {
        failed = true;
        rows.push(
            row(
                "FAIL",
                input.totalSeconds,
                `the quick gate is over its budget of ${input.quickLimit}s: move the slow step to the full gate or speed it up; a machine that is slow across the board runs with SUWGATE_QUICK_LIMIT=<seconds>`,
            ),
        );
    }
    const extras = [
        `${input.exceptions} exception${input.exceptions === 1 ? "" : "s"} in suwgate.yml`,
        ...(skippedByConfig.length > 0 ? [`skipped in suwgate.yml: ${skippedByConfig.join(", ")}`] : []),
    ].join("; ");
    const lines: string[] = [];
    if (failures.length > 0) lines.push("", failures.join("\n\n"));
    const clean = !failed && notVerified.length === 0 && skippedByConfig.length === 0;
    if (clean && !input.verbose) {
        lines.push(`PASS ${input.command}: all ${passedCount} steps in ${input.totalSeconds}s (${extras})`);
    } else {
        if (lines.length > 0) lines.push("");
        lines.push(
            ...rows,
            `  ${failed ? "FAIL" : "PASS"} ${input.command}: ${passedCount} passed, total ${input.totalSeconds}s (${extras})`,
        );
    }
    if (notVerified.length > 0) lines.push(`NOT VERIFIED: ${notVerified.join(" ")}`);
    return { text: lines.join("\n").replace(/^\n/, ""), passed: !failed };
}
