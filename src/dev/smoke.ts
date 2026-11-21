import { Failure, UsageError, type Exec, type Io } from "./process.ts";
import type { DevSettings, SmokeCheck } from "./settings.ts";

export const SMOKE_USAGE = `usage: suwgate dev smoke [<base-url> | --ci]   e.g. suwgate dev smoke http://127.0.0.1:8190
Smoke test of a running stack. Read-only requests through the web's nginx, the way traffic arrives: the page answers, and
the server behind it answers with its database. The base url defaults to the stack's web port (dev.ports.stack);
the requests are dev.smoke.checks (default: /healthz and /api/health). Prints what failed and what to look at;
the exit code is non-zero on any failure.
  --ci   build the images and start the whole stack of the compose file (with dev.compose.profile) as its own compose project
         <dev.name>-ci with the image tag ci, every published port moved to a free loopback port so nothing collides with a stack
         already running on the machine; smoke-test it through the port that stands for dev.ports.stack, print the logs when
         anything fails, and always remove the project with its volumes, also when the run is interrupted`;

export type Fetch = (url: string) => Promise<{ status: number; body: string }>;

export interface SmokeCommand {
    baseUrl: string | null;
    ci: boolean;
}

const TIMEOUT_MS = 10_000;

export function parseSmoke(args: readonly string[]): SmokeCommand {
    const [first, ...rest] = args;
    if (rest.length > 0) throw new UsageError(SMOKE_USAGE);
    if (first === "--ci") return { baseUrl: null, ci: true };
    if (first?.startsWith("-") === true) throw new UsageError(SMOKE_USAGE);
    return { baseUrl: first ?? null, ci: false };
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

export interface PublishedPort {
    service: string;
    target: number;
    published: string;
    protocol: string;
}

export interface SmokeCiEnvironment {
    settings: DevSettings;
    exec: Exec;
    fetch: Fetch;
    io: Io;
    temporaryFile: (name: string, text: string) => string;
    onInterrupt: (cleanup: readonly string[]) => () => void;
}

const CI_ENV = { IMAGE_TAG: "ci" };

function ciProject(settings: DevSettings): string {
    return `${settings.name}-ci`;
}

function composeCi(settings: DevSettings, override: string | null): string[] {
    return [
        "docker",
        "compose",
        "-f",
        `${settings.root}/${settings.compose.file}`,
        ...(override === null ? [] : ["-f", override]),
        "-p",
        ciProject(settings),
        "--profile",
        settings.compose.profile,
    ];
}

interface ComposeConfig {
    services?: Record<string, { ports?: { target: number; published?: string | number; protocol?: string }[] }>;
}

export function publishedPorts(configJson: string): PublishedPort[] {
    const config = JSON.parse(configJson) as ComposeConfig;
    return Object.entries(config.services ?? {}).flatMap(([service, definition]) =>
        (definition.ports ?? []).map((port) => ({
            service,
            target: port.target,
            published: String(port.published ?? ""),
            protocol: port.protocol ?? "tcp",
        })),
    );
}

export function loopbackOverride(ports: readonly PublishedPort[]): string {
    const services = [...new Set(ports.map((port) => port.service))];
    const lines = services.flatMap((service) => [
        `  ${service}:`,
        "    ports: !override",
        ...ports
            .filter((port) => port.service === service)
            .map((port) => `      - "127.0.0.1::${String(port.target)}${port.protocol === "tcp" ? "" : `/${port.protocol}`}"`),
    ]);
    return ["services:", ...lines, ""].join("\n");
}

function hostPortOf(output: string): string | null {
    const match = /:(\d+)\s*$/m.exec(output.trim().split("\n")[0] ?? "");
    return match?.[1] ?? null;
}

async function stackOf(environment: SmokeCiEnvironment): Promise<{ ports: PublishedPort[]; entry: PublishedPort }> {
    const { settings, exec } = environment;
    const config = await exec([...composeCi(settings, null), "config", "--format", "json"], { capture: true, env: CI_ENV });
    if (config.status !== 0) {
        throw new Failure(`suwgate dev smoke --ci: the compose file does not resolve: ${composeCi(settings, null).join(" ")} config`);
    }
    const ports = publishedPorts(config.stdout);
    const stack = String(settings.ports.stack);
    const entry = ports.find((port) => port.published === stack);
    if (entry === undefined) {
        throw new Failure(
            `suwgate dev smoke --ci: no service of ${settings.compose.file} publishes dev.ports.stack (${stack}): publish the web's port as ${stack}, or set dev.ports.stack in suwgate.yml to the port the web publishes`,
            2,
        );
    }
    return { ports, entry };
}

async function smokeStack(compose: readonly string[], entry: PublishedPort, environment: SmokeCiEnvironment): Promise<number> {
    const { exec, io } = environment;
    const up = await exec([...compose, "up", "-d", "--build", "--wait"], { env: CI_ENV });
    if (up.status !== 0) {
        io.err(`FAIL  the stack did not start healthy (${compose.join(" ")} up -d --build --wait); its logs follow`);
        return 1;
    }
    const port = await exec([...compose, "port", entry.service, String(entry.target)], { capture: true, env: CI_ENV });
    const hostPort = port.status === 0 ? hostPortOf(port.stdout) : null;
    if (hostPort === null) {
        io.err(`FAIL  ${entry.service} publishes no port for ${String(entry.target)} (${compose.join(" ")} port); its logs follow`);
        return 1;
    }
    return runSmoke({ baseUrl: `http://127.0.0.1:${hostPort}`, ci: false }, environment.settings, environment.fetch, io);
}

export async function runSmokeCi(environment: SmokeCiEnvironment): Promise<number> {
    const { settings, exec, io } = environment;
    const { ports, entry } = await stackOf(environment);
    const compose = composeCi(settings, environment.temporaryFile("compose.ci.yaml", loopbackOverride(ports)));
    const down = [...compose, "down", "--remove-orphans", "--volumes"];
    const release = environment.onInterrupt(down);
    try {
        const status = await smokeStack(compose, entry, environment);
        if (status !== 0) await exec([...compose, "logs", "--no-color"], { env: CI_ENV });
        return status;
    } finally {
        release();
        const removed = await exec(down, { env: CI_ENV });
        if (removed.status !== 0) io.err(`suwgate dev smoke --ci: the project ${ciProject(settings)} was not removed: ${down.join(" ")}`);
    }
}
