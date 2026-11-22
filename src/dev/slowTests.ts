import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkoutEnvOf } from "./checkoutEnv.ts";
import { runDb } from "./db.ts";
import { Failure, UsageError, type Exec, type Io } from "./process.ts";
import type { DevSettings } from "./settings.ts";

export const SLOW_TESTS_USAGE = `usage: suwgate dev slow-tests [-n <count>]
Which .NET tests take the longest? A report, not a check: it never fails for time, and suwgate check never runs it. A test far
slower than its neighbours usually waits for something (a timeout, a server started per test) and passes anyway.
Sets the environment of suwgate dev checkout-env, starts the database like suwgate dev db up, builds the solution (the one
*.slnx or *.sln in directories.dotnet, or in the root; none or several: exit 2), runs dotnet test --no-build with an xunit TRX
report in .artifacts/slow-tests (its output in run.log there), and lists the slowest tests with how long each took:
  suwgate dev slow-tests        the 10 slowest
  suwgate dev slow-tests -n 25  the 25 slowest
Exit 1 when a test fails (the list still comes first), or the build or the database fails.`;

const DEFAULT_COUNT = 10;
export const RESULTS_FOLDER = ".artifacts/slow-tests";
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

export interface SlowTestsEnvironment {
    settings: DevSettings;
    env: Readonly<Record<string, string | undefined>>;
    exec: Exec;
    io: Io;
}

export interface TestTime {
    seconds: number;
    name: string;
}

export function parseSlowTests(args: readonly string[]): number {
    if (args.length === 0) return DEFAULT_COUNT;
    const [flag, count, ...rest] = args;
    if (flag !== "-n" || count === undefined || rest.length > 0 || !/^[1-9]\d*$/.test(count)) throw new UsageError(SLOW_TESTS_USAGE);
    return Number(count);
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescaped(value: string): string {
    return value.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (entity: string, decimal?: string, hex?: string, named?: string) => {
        if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
        if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
        return ENTITIES[named ?? ""] ?? entity;
    });
}

function seconds(duration: string): number {
    const [hours = "0", minutes = "0", rest = "0"] = duration.split(":");
    return Number(hours) * SECONDS_PER_HOUR + Number(minutes) * SECONDS_PER_MINUTE + Number(rest);
}

const RESULT_TAG = /<[\w.-]*:?[\w.-]*UnitTestResult((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g;
const ATTRIBUTE = /([\w:.-]+)="([^"]*)"/g;

export function parseTrx(text: string): TestTime[] {
    return Array.from(text.matchAll(RESULT_TAG), (tag) => {
        const attributes = new Map(Array.from((tag[1] ?? "").matchAll(ATTRIBUTE), (attribute) => [attribute[1], attribute[2]] as const));
        return { duration: attributes.get("duration"), name: attributes.get("testName") };
    }).flatMap(({ duration, name }) =>
        duration === undefined || duration === "" || name === undefined ? [] : [{ seconds: seconds(duration), name: unescaped(name) }],
    );
}

export function slowest(times: readonly TestTime[], count: number): string[] {
    const sorted = [...times].sort((first, second) => second.seconds - first.seconds);
    return [
        `${sorted.length} tests, the ${Math.min(count, sorted.length)} slowest:`,
        ...sorted.slice(0, count).map((time) => `${time.seconds.toFixed(2).padStart(7)} s  ${time.name}`),
    ];
}

function solutionOf(settings: DevSettings): string {
    const directory = path.join(settings.root, settings.dotnetDirectory ?? "");
    const found = readdirSync(directory)
        .filter((file) => file.endsWith(".slnx") || file.endsWith(".sln"))
        .sort();
    const [solution] = found;
    if (solution !== undefined && found.length === 1) return path.join(directory, solution);
    throw new Failure(
        found.length === 0
            ? `suwgate dev slow-tests: no .slnx or .sln in ${directory}: set directories.dotnet in suwgate.yml to the folder of the solution`
            : `suwgate dev slow-tests: ${found.length} solutions in ${directory} (${found.join(", ")}): keep one, or point directories.dotnet at the folder of the one to run`,
        2,
    );
}

export async function runSlowTests(count: number, environment: SlowTestsEnvironment): Promise<number> {
    const { settings, io } = environment;
    const solution = solutionOf(settings);
    const checkout = checkoutEnvOf(settings, environment.env);
    if (checkout.notice !== null) io.err(checkout.notice);
    const variables = Object.fromEntries(checkout.variables);
    const exec: Exec = (argv, options) => environment.exec(argv, { ...options, env: { ...variables, ...options?.env } });
    const results = path.join(settings.root, RESULTS_FOLDER);
    rmSync(results, { recursive: true, force: true });
    mkdirSync(results, { recursive: true });

    const database = await runDb(
        { kind: "up" },
        { settings, exec, io: { out: () => undefined, err: (text) => io.err(text) }, interactive: false, ask: () => Promise.resolve("") },
    );
    if (database !== 0) throw new Failure(`suwgate dev slow-tests: the database did not start (exit ${database})`);
    const built = await exec(["dotnet", "build", solution, "--nologo", "-v", "q"], { capture: true });
    if (built.status !== 0) {
        io.err(built.stdout);
        throw new Failure(`suwgate dev slow-tests: dotnet build of ${solution} failed (exit ${built.status}), its output is above`);
    }
    const log = path.join(results, "run.log");
    const tested = await exec(
        ["dotnet", "test", "--solution", solution, "--no-build", "--no-progress", "--report-xunit-trx", "--results-directory", results],
        { capture: true, quiet: true },
    );
    writeFileSync(log, tested.stdout);
    const times = readdirSync(results)
        .filter((file) => file.endsWith(".trx"))
        .flatMap((file) => parseTrx(readFileSync(path.join(results, file), "utf8")));
    for (const line of slowest(times, count)) io.out(line);
    if (tested.status !== 0) throw new Failure(`suwgate dev slow-tests: a test failed; the run's output is in ${log}`);
    return 0;
}
