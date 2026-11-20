import { readFileSync } from "node:fs";
import path from "node:path";

import { CONFIG_FILE, type Config } from "./config.ts";
import type { Finding, Guard, GuardException } from "./contract.ts";

interface GuardsSummary {
    passed: boolean;
    log: string;
}

interface GuardsInput {
    root: string;
    guards: readonly Guard[];
    files: readonly string[];
    config: Config;
}

function shown(guard: Guard, finding: Finding): string {
    return `${guard.id}: ${finding.target}${finding.line === undefined ? "" : `:${finding.line}`}: ${finding.message}`;
}

async function findingsOf(guard: Guard, input: GuardsInput, exceptions: readonly GuardException[]): Promise<readonly Finding[]> {
    try {
        return await guard.check({
            root: input.root,
            files: input.files,
            profiles: input.config.profiles,
            directories: input.config.directories,
            exceptions,
            settings: input.config.settings[guard.id],
            read: (file) => readFileSync(path.join(input.root, file), "utf8"),
        });
    } catch (error) {
        return [
            {
                target: guard.id,
                message: `the guard itself failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
            },
        ];
    }
}

export async function runGuards(input: GuardsInput): Promise<GuardsSummary> {
    const lines: string[] = [];
    let excepted = 0;
    let failed = false;
    for (const guard of input.guards) {
        const exceptions = input.config.exceptions.filter((exception) => exception.guard === guard.id);
        const used = new Set<GuardException>();
        for (const finding of await findingsOf(guard, input, exceptions)) {
            const exception = exceptions.find((candidate) => candidate.target === finding.target);
            if (exception === undefined) {
                lines.push(shown(guard, finding));
                failed = true;
            } else {
                used.add(exception);
            }
        }
        excepted += used.size;
        for (const stale of exceptions.filter((exception) => !used.has(exception))) {
            lines.push(`${guard.id}: ${stale.target}: the exception in ${CONFIG_FILE} matches nothing any more: delete it`);
            failed = true;
        }
    }
    const header = `${input.guards.length} guard${input.guards.length === 1 ? "" : "s"}, ${excepted} findings excepted in ${CONFIG_FILE}`;
    return { passed: !failed, log: [header, ...lines].join("\n") };
}
