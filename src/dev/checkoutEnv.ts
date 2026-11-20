import { execFileSync } from "node:child_process";
import path from "node:path";

import { Failure, quoted, type Io } from "./process.ts";
import type { DevSettings } from "./settings.ts";

export const CHECKOUT_ENV_USAGE = `usage: eval "$(suwgate dev checkout-env)"
Prints shell \`export\` lines, so the shell that evals them has the variables of this checkout: the builds leave no worker
processes behind (MSBUILDDISABLENODEREUSE, DOTNET_CLI_USE_MSBUILD_SERVER), and a linked git worktree gets its own test and
e2e databases and its own e2e ports, so checkouts that run the gate or the browser tests at the same time do not collide.
The main checkout and CI keep the plain names and ports (<database>_e2e, ports dev.ports.e2eServer and e2eWeb). A linked
worktree takes a suffix from its directory name (lower-case [a-z0-9_], at most 30 chars, and a hash of the name) for the
database names and a port pair (20000-29999) from the same hash. Nothing is cleaned up afterwards: a worktree's databases
stay until you drop them. A value already in the environment wins. What it chose goes to stderr.`;

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    return value >>> 0;
});

const SUFFIX_NAME_LENGTH = 30;
const PORT_BASE = 20000;
const PORT_PAIRS = 5000;

function step(crc: number, byte: number): number {
    return ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
}

export function cksum(text: string): number {
    const bytes = Buffer.from(text, "utf8");
    let crc = 0;
    for (const byte of bytes) crc = step(crc, byte);
    for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) crc = step(crc, length % 256);
    return ~crc >>> 0;
}

export function suffixOf(name: string): string {
    const safe = Array.from(Buffer.from(name.toLowerCase(), "utf8"), (byte) =>
        /[a-z0-9_]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : "_",
    ).join("");
    return `${safe.slice(0, SUFFIX_NAME_LENGTH)}_${cksum(name)}`;
}

export interface CheckoutInputs {
    checkoutName: string;
    linked: boolean;
    ci: boolean;
    env: Readonly<Record<string, string | undefined>>;
    settings: DevSettings;
}

export interface CheckoutEnv {
    variables: [string, string][];
    notice: string | null;
}

export function checkoutEnv(inputs: CheckoutInputs): CheckoutEnv {
    const { settings, env } = inputs;
    const chosen = (name: string, fallback: string): string => {
        const set = env[name];
        return set !== undefined && set !== "" ? set : fallback;
    };
    const { database } = settings;
    const isolated = !inputs.ci && inputs.linked;
    const suffix = suffixOf(inputs.checkoutName);
    const base = PORT_BASE + (cksum(inputs.checkoutName) % PORT_PAIRS) * 2;
    const variables: [string, string][] = [
        ["MSBUILDDISABLENODEREUSE", "1"],
        ["DOTNET_CLI_USE_MSBUILD_SERVER", "0"],
        ["E2E_DATABASE", chosen("E2E_DATABASE", isolated ? `${database.name}_e2e_${suffix}` : `${database.name}_e2e`)],
    ];
    if (isolated) {
        variables.push([
            "TEST_CONNECTION_STRING",
            chosen(
                "TEST_CONNECTION_STRING",
                `Host=127.0.0.1;Port=${settings.ports.database};Database=${database.name}_test_${suffix};Username=${database.user};Password=${database.password}`,
            ),
        ]);
    }
    variables.push(
        ["E2E_SERVER_PORT", chosen("E2E_SERVER_PORT", String(isolated ? base : settings.ports.e2eServer))],
        ["E2E_WEB_PORT", chosen("E2E_WEB_PORT", String(isolated ? base + 1 : settings.ports.e2eWeb))],
    );
    const value = (name: string) => variables.find(([key]) => key === name)?.[1] ?? "";
    const notice = isolated
        ? `checkout ${inputs.checkoutName}: test database ${database.name}_test_${suffix}, e2e database ${value("E2E_DATABASE")}, e2e ports ${value("E2E_SERVER_PORT")}/${value("E2E_WEB_PORT")}`
        : null;
    return { variables, notice };
}

export function exportLines(variables: readonly (readonly [string, string])[]): string {
    return variables.map(([name, value]) => `export ${name}=${quoted(value)}`).join("\n");
}

function gitPath(root: string, args: readonly string[]): string | null {
    try {
        return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return null;
    }
}

export function isLinkedWorktree(root: string): boolean {
    const gitDir = gitPath(root, ["rev-parse", "--absolute-git-dir"]);
    const commonDir = gitPath(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (gitDir === null || commonDir === null) {
        throw new Failure(
            `suwgate dev checkout-env: ${root} is not a git checkout, so a linked worktree cannot be told from the main one: run it in a cloned repository or worktree`,
        );
    }
    return gitDir !== commonDir;
}

export function runCheckoutEnv(
    args: readonly string[],
    settings: DevSettings,
    env: Readonly<Record<string, string | undefined>>,
    io: Io,
): number {
    if (args.length > 0) {
        io.err(CHECKOUT_ENV_USAGE);
        return 2;
    }
    const ci = (env["CI"] ?? "") !== "";
    const result = checkoutEnv({
        checkoutName: path.basename(settings.root),
        linked: ci ? false : isLinkedWorktree(settings.root),
        ci,
        env,
        settings,
    });
    io.out(exportLines(result.variables));
    if (result.notice !== null) io.err(result.notice);
    return 0;
}
