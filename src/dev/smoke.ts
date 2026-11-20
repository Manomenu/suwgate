import { UsageError, type Io } from "./process.ts";
import type { DevSettings, SmokeCheck } from "./settings.ts";

export const SMOKE_USAGE = `usage: suwgate dev smoke [<base-url>]   e.g. suwgate dev smoke http://127.0.0.1:8190
Smoke test of a running stack. Read-only requests through the web's nginx, the way traffic arrives: the page answers, and
the server behind it answers with its database. The base url defaults to the stack's web port (dev.ports.stack);
the requests are dev.smoke.checks (default: /healthz and /api/health). Prints what failed and what to look at;
the exit code is non-zero on any failure.`;

export type Fetch = (url: string) => Promise<{ status: number; body: string }>;

export interface SmokeCommand {
    baseUrl: string | null;
}

const TIMEOUT_MS = 10_000;

export function parseSmoke(args: readonly string[]): SmokeCommand {
    const [first, ...rest] = args;
    if (rest.length > 0 || first?.startsWith("-") === true) throw new UsageError(SMOKE_USAGE);
    return { baseUrl: first ?? null };
}

export function baseUrlOf(settings: DevSettings, command: SmokeCommand): string {
    return (command.baseUrl ?? `http://127.0.0.1:${settings.ports.stack}`).replace(/\/+$/, "");
}

export const realFetch: Fetch = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, body: await response.text() };
};

export async function checkOne(base: string, check: SmokeCheck, fetcher: Fetch): Promise<string | null> {
    let status: string;
    let body = "";
    try {
        const response = await fetcher(`${base}${check.path}`);
        status = String(response.status);
        body = response.body;
    } catch {
        status = "unreachable";
    }
    if (status === "200" && new RegExp(check.expect, "m").test(body)) return null;
    return `${base}${check.path}: got status '${status}', expected 200 with '${check.expect}' in the body. ${check.hint}`;
}

export async function runSmoke(command: SmokeCommand, settings: DevSettings, fetcher: Fetch, io: Io): Promise<number> {
    const base = baseUrlOf(settings, command);
    let failed = false;
    for (const check of settings.smokeChecks) {
        const failure = await checkOne(base, check, fetcher);
        if (failure === null) {
            io.out(`ok    ${check.path}`);
        } else {
            io.err(`FAIL  ${failure}`);
            failed = true;
        }
    }
    return failed ? 1 : 0;
}
