import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Failure, UsageError, type Exec, type Io } from "./process.ts";
import type { DevSettings, SiblingSettings } from "./settings.ts";
import type { Fetch } from "./smoke.ts";

export const SIBLING_USAGE = `usage: suwgate dev sibling [<name> image | up | rebuild | down | status]   (every command takes --help)
The Docker images of a sibling repository checked out next to this one (dev.siblings.<name> of suwgate.yml), rebuilt from
its checkout whenever they are not what it holds now: an image is missing, it was built from another commit, it was rebuilt
or pulled since suwgate built it, or the checkout has uncommitted changes. With no name: every sibling, its checkout and
whether its images are current.
  image    make the images current, without starting anything
  up       image, then start them with dev.siblings.<name>.compose and wait until dev.siblings.<name>.health answers
  rebuild  build the images whatever their state, and recreate the stack when it runs
  down     stop the stack; its data stays
  status   does health answer, what compose runs, are the images current`;

const ACTION_USAGES = {
    image: `usage: suwgate dev sibling <name> image
Makes the images of dev.siblings.<name>.images current without starting anything: runs dev.siblings.<name>.build in the
sibling's checkout when an image is missing, the images were built from another commit than the checkout's HEAD, an image is
not the one suwgate built (rebuilt or pulled since), or the checkout has uncommitted changes, untracked files included. Prints
one line: why it rebuilds, or that the images are current. Without a checkout, images that exist run as they are.`,
    up: `usage: suwgate dev sibling <name> up
image, then docker compose -f <dev.siblings.<name>.compose> up -d, which recreates a container whose image changed, then waits
up to 2 minutes until dev.siblings.<name>.health answers 2xx. Prints <name>: <the address of health, or up>. Needs compose.`,
    rebuild: `usage: suwgate dev sibling <name> rebuild
Runs dev.siblings.<name>.build in the sibling's checkout whatever the state of the images, records it, and recreates the stack
of dev.siblings.<name>.compose when it runs.`,
    down: `usage: suwgate dev sibling <name> down
docker compose -f <dev.siblings.<name>.compose> down: stops the stack and removes its containers; its volumes and data stay.`,
    status: `usage: suwgate dev sibling <name> status
Whether dev.siblings.<name>.health answers, docker compose ps of dev.siblings.<name>.compose, and whether the images are
current, by the rule of image, without building anything.`,
} as const;

type SiblingAction = keyof typeof ACTION_USAGES;

export type SiblingCommand = { kind: "list" } | { kind: "help"; text: string } | { kind: "run"; name: string; action: SiblingAction };

export interface SiblingEnvironment {
    settings: DevSettings;
    exec: Exec;
    fetch: Fetch;
    io: Io;
    pause: (milliseconds: number) => Promise<void>;
}

interface SiblingState {
    revision: string;
    images: Record<string, unknown>;
}

interface Look {
    revision: string | null;
    ids: ReadonlyMap<string, string>;
    dirty: boolean;
    state: SiblingState | null;
}

const STATE_FOLDER = ".artifacts/dev/siblings";
const SHORT_REVISION = 9;
const HEALTH_ATTEMPTS = 60;
const HEALTH_PAUSE_MS = 2000;
const SUCCESS = { min: 200, max: 299 };

function isAction(word: string): word is SiblingAction {
    return Object.hasOwn(ACTION_USAGES, word);
}

export function parseSibling(args: readonly string[]): SiblingCommand {
    const [name, action, ...rest] = args;
    if (name === undefined) return { kind: "list" };
    if (name.startsWith("-") || action === undefined) throw new UsageError(SIBLING_USAGE);
    if (action === "--help" && rest.length === 0) return { kind: "help", text: SIBLING_USAGE };
    if (!isAction(action)) throw new UsageError(SIBLING_USAGE);
    if (rest.length === 0) return { kind: "run", name, action };
    if (rest.length === 1 && rest[0] === "--help") return { kind: "help", text: ACTION_USAGES[action] };
    throw new UsageError(`suwgate dev sibling <name> ${action} takes no arguments\n${ACTION_USAGES[action]}`);
}

function short(revision: string): string {
    return revision.slice(0, SHORT_REVISION);
}

function stateFile(settings: DevSettings, sibling: SiblingSettings): string {
    return path.join(settings.root, STATE_FOLDER, `${sibling.name}.json`);
}

function readState(file: string): SiblingState | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const { revision, images } = parsed as Record<string, unknown>;
    if (typeof revision !== "string" || typeof images !== "object" || images === null) return null;
    return { revision, images: images as Record<string, unknown> };
}

async function captured(exec: Exec, argv: readonly string[]): Promise<string | null> {
    const { status, stdout } = await exec(argv, { capture: true, quiet: true });
    return status === 0 ? stdout.trim() : null;
}

async function imageIds(sibling: SiblingSettings, exec: Exec): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const image of sibling.images) {
        const id = await captured(exec, ["docker", "image", "inspect", "-f", "{{.Id}}", image]);
        if (id !== null && id !== "") ids.set(image, id);
    }
    return ids;
}

function revisionOf(sibling: SiblingSettings, exec: Exec): Promise<string | null> {
    return captured(exec, ["git", "-C", sibling.checkout, "rev-parse", "HEAD"]);
}

async function lookAt(sibling: SiblingSettings, environment: SiblingEnvironment): Promise<Look> {
    const { exec, settings } = environment;
    const revision = await revisionOf(sibling, exec);
    const ids = await imageIds(sibling, exec);
    const changes = revision === null ? null : await captured(exec, ["git", "-C", sibling.checkout, "status", "--porcelain"]);
    return { revision, ids, dirty: (changes ?? "") !== "", state: readState(stateFile(settings, sibling)) };
}

function missingImage(sibling: SiblingSettings, ids: ReadonlyMap<string, string>): string | undefined {
    return sibling.images.find((image) => !ids.has(image));
}

function staleReason(sibling: SiblingSettings, revision: string, look: Omit<Look, "revision">): string | null {
    const missing = missingImage(sibling, look.ids);
    if (missing !== undefined) return `the image ${missing} is missing`;
    if (look.state === null) return "suwgate has no record of the commit they were built from";
    if (look.state.revision !== revision) return `the images are from ${short(look.state.revision)}, the checkout is at ${short(revision)}`;
    const { images } = look.state;
    const changed = sibling.images.find((image) => images[image] !== look.ids.get(image));
    if (changed !== undefined) return `the image ${changed} is not the one suwgate built (rebuilt or pulled since)`;
    if (look.dirty) return `the checkout at ${short(revision)} has uncommitted changes`;
    return null;
}

function noCheckout(sibling: SiblingSettings): string {
    return `there is no git checkout of ${sibling.name} at ${sibling.checkout}`;
}

function checkoutFix(sibling: SiblingSettings): string {
    return `clone it there, or set dev.siblings.${sibling.name}.checkout in suwgate.yml`;
}

function describe(sibling: SiblingSettings, look: Look): string {
    if (look.revision === null) {
        const missing = missingImage(sibling, look.ids);
        if (missing !== undefined)
            return `the image ${missing} is missing and ${noCheckout(sibling)} to build it from: ${checkoutFix(sibling)}`;
        return `${noCheckout(sibling)}, so its images run as they are: ${checkoutFix(sibling)}`;
    }
    const reason = staleReason(sibling, look.revision, look);
    if (reason === null) return `the images are current (${short(look.revision)})`;
    return `the images are not current, ${reason}: suwgate dev sibling ${sibling.name} image rebuilds them`;
}

async function build(sibling: SiblingSettings, revision: string, environment: SiblingEnvironment): Promise<void> {
    const { exec, settings } = environment;
    const { status } = await exec(["bash", "-c", sibling.build], { cwd: sibling.checkout });
    if (status !== 0) {
        throw new Failure(
            `${sibling.name}: the build failed (exit ${status}): ${sibling.build} in ${sibling.checkout}; fix it there and run suwgate dev sibling ${sibling.name} image again`,
        );
    }
    const ids = await imageIds(sibling, exec);
    const missing = missingImage(sibling, ids);
    if (missing !== undefined) {
        throw new Failure(
            `${sibling.name}: the build passed but made no image ${missing}: make the build tag it so, or list the images it makes in dev.siblings.${sibling.name}.images`,
        );
    }
    const file = stateFile(settings, sibling);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ revision, images: Object.fromEntries(ids) }, null, 4)}\n`);
}

async function makeCurrent(sibling: SiblingSettings, environment: SiblingEnvironment): Promise<void> {
    const look = await lookAt(sibling, environment);
    const { io } = environment;
    if (look.revision === null) {
        if (missingImage(sibling, look.ids) !== undefined) throw new Failure(`${sibling.name}: ${describe(sibling, look)}`);
        io.out(`${sibling.name}: ${describe(sibling, look)}`);
        return;
    }
    const reason = staleReason(sibling, look.revision, look);
    if (reason === null) {
        io.out(`${sibling.name}: ${describe(sibling, look)}`);
        return;
    }
    io.out(`${sibling.name}: rebuilding, ${reason}`);
    await build(sibling, look.revision, environment);
}

function composeOf(settings: DevSettings, sibling: SiblingSettings, action: SiblingAction): string[] {
    if (sibling.compose === null) {
        throw new Failure(
            `suwgate dev sibling ${sibling.name} ${action} needs dev.siblings.${sibling.name}.compose in suwgate.yml, the compose file of this repository that runs its images; suwgate dev sibling ${sibling.name} image makes the images current without one`,
            2,
        );
    }
    return ["docker", "compose", "-f", `${settings.root}/${sibling.compose}`];
}

async function answers(url: string, fetcher: Fetch): Promise<boolean> {
    try {
        const { status } = await fetcher(url);
        return status >= SUCCESS.min && status <= SUCCESS.max;
    } catch {
        return false;
    }
}

async function waitForHealth(
    sibling: SiblingSettings,
    health: string,
    compose: readonly string[],
    environment: SiblingEnvironment,
): Promise<void> {
    for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
        if (await answers(health, environment.fetch)) return;
        if (attempt < HEALTH_ATTEMPTS) await environment.pause(HEALTH_PAUSE_MS);
    }
    throw new Failure(`${sibling.name} did not answer at ${health} within 2 minutes: see ${compose.join(" ")} logs`);
}

async function start(sibling: SiblingSettings, compose: readonly string[], environment: SiblingEnvironment): Promise<void> {
    const { status } = await environment.exec([...compose, "up", "-d"]);
    if (status !== 0)
        throw new Failure(`${sibling.name}: ${compose.join(" ")} up -d failed (exit ${status}): see ${compose.join(" ")} logs`);
    if (sibling.health === null) {
        environment.io.out(`${sibling.name}: up`);
        return;
    }
    await waitForHealth(sibling, sibling.health, compose, environment);
    environment.io.out(`${sibling.name}: ${new URL(sibling.health).origin}`);
}

async function rebuild(sibling: SiblingSettings, environment: SiblingEnvironment): Promise<void> {
    const { exec, settings, io } = environment;
    const revision = await revisionOf(sibling, exec);
    if (revision === null) throw new Failure(`${sibling.name}: ${noCheckout(sibling)} to build from: ${checkoutFix(sibling)}`);
    io.out(`${sibling.name}: rebuilding from ${short(revision)}`);
    await build(sibling, revision, environment);
    if (sibling.compose === null) return;
    const compose = composeOf(settings, sibling, "rebuild");
    const running = await captured(exec, [...compose, "ps", "-q"]);
    if (running !== null && running !== "") await start(sibling, compose, environment);
}

async function status(sibling: SiblingSettings, environment: SiblingEnvironment): Promise<void> {
    const { io, settings } = environment;
    if (sibling.health !== null) {
        io.out(
            (await answers(sibling.health, environment.fetch))
                ? `${sibling.name}: answers at ${sibling.health}`
                : `${sibling.name}: does not answer at ${sibling.health}: suwgate dev sibling ${sibling.name} up starts it`,
        );
    }
    if (sibling.compose !== null) await environment.exec([...composeOf(settings, sibling, "status"), "ps"]);
    io.out(`${sibling.name}: ${describe(sibling, await lookAt(sibling, environment))}`);
}

async function list(environment: SiblingEnvironment): Promise<void> {
    const { siblings } = environment.settings;
    if (siblings.length === 0) {
        environment.io.out(
            "no siblings in suwgate.yml: add dev.siblings.<name> with the images its build makes (see docs/dev.md of suwgate)",
        );
        return;
    }
    for (const sibling of siblings) {
        environment.io.out(`${sibling.name} (${sibling.checkout}): ${describe(sibling, await lookAt(sibling, environment))}`);
    }
}

function siblingNamed(settings: DevSettings, name: string): SiblingSettings {
    const found = settings.siblings.find((sibling) => sibling.name === name);
    if (found !== undefined) return found;
    const known = settings.siblings.map((sibling) => sibling.name);
    const named = known.length === 0 ? "" : ` (the siblings are ${known.join(", ")})`;
    throw new Failure(
        `suwgate dev sibling: no sibling "${name}" in suwgate.yml${named}: name one of them, or add dev.siblings.${name} with the images its build makes`,
        2,
    );
}

async function run(sibling: SiblingSettings, action: SiblingAction, environment: SiblingEnvironment): Promise<number> {
    const { settings, exec } = environment;
    switch (action) {
        case "image":
            await makeCurrent(sibling, environment);
            return 0;
        case "up": {
            const compose = composeOf(settings, sibling, action);
            await makeCurrent(sibling, environment);
            await start(sibling, compose, environment);
            return 0;
        }
        case "rebuild":
            await rebuild(sibling, environment);
            return 0;
        case "down":
            return (await exec([...composeOf(settings, sibling, action), "down"])).status;
        case "status":
            await status(sibling, environment);
            return 0;
    }
}

export async function runSibling(command: Exclude<SiblingCommand, { kind: "help" }>, environment: SiblingEnvironment): Promise<number> {
    if (command.kind === "list") {
        await list(environment);
        return 0;
    }
    return run(siblingNamed(environment.settings, command.name), command.action, environment);
}
