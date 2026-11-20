import type { Step, StepContext } from "../gate/contract.ts";
import { PNPM_INSTALL } from "./node.ts";
import { countedVitest, has, quoted, read, script } from "./shell.ts";

const CHANGESET = script([
    'base=""',
    "if git rev-parse --verify -q origin/master >/dev/null; then base=origin/master; elif git rev-parse --verify -q master >/dev/null; then base=master; fi",
    'if [ -z "$base" ] || [ "$(git rev-parse HEAD 2>/dev/null)" = "$(git rev-parse "$base")" ]; then echo "on $base itself or no master yet: nothing to compare with"; exit 0; fi',
    'pnpm exec changeset status --since "$base"',
]);

const PUBLINT = script([
    'work="$(mktemp -d)"',
    "trap 'rm -rf \"$work\"' EXIT",
    'pnpm pack --pack-destination "$work" >/dev/null',
    'pnpm exec publint "$work"/*.tgz --strict',
]);

const STORYBOOK = ".storybook";

export const VISUAL_CONFIG = "visual/playwright.config.ts";

export const CONSUMER = "gate/consumer";

function consumerAppCommand(build: string): string {
    return script([
        'work="$(mktemp -d)"',
        "trap 'rm -rf \"$work\"' EXIT",
        'pnpm pack --pack-destination "$work" >/dev/null',
        'tarball="$(ls "$work"/*.tgz)"',
        `cp -r ${CONSUMER}/app "$work/app"`,
        `(cd "$work/app" && pnpm add "$tarball" --silent && ${build})`,
        `port="$(node -e 'const server = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')"`,
        `CONSUMER_APP="$work/app" CONSUMER_PORT="$port" pnpm exec playwright test -c ${CONSUMER}/playwright.config.ts`,
    ]);
}

function stories(context: StepContext): string | null {
    return has(context, STORYBOOK) ? countedVitest("stories", "pnpm exec vitest run --project stories") : null;
}

function playwrightVersion(context: StepContext): string | null {
    const manifest = read(context, "node_modules/@playwright/test/package.json");
    if (manifest === null) return null;
    const { version } = JSON.parse(manifest) as { version?: unknown };
    return typeof version === "string" ? version : null;
}

export function visual(context: StepContext): string | null {
    if (!has(context, STORYBOOK) || !has(context, VISUAL_CONFIG)) return null;
    const version = playwrightVersion(context);
    if (version === null) {
        return `echo "${VISUAL_CONFIG} runs in the Playwright image of the installed @playwright/test, which is not installed: pnpm add -D @playwright/test" >&2; exit 1`;
    }
    return script([
        "pnpm exec storybook build --quiet -o storybook-static >/dev/null",
        `docker run --rm --init --ipc=host --security-opt label=disable -v "$PWD:/work" -w /work -e CI mcr.microsoft.com/playwright:v${version}-noble node_modules/.bin/playwright test -c ${VISUAL_CONFIG}`,
    ]);
}

const NOT_A_MODULE = /\.(css|json)$/;

function targets(entry: unknown): string[] {
    if (typeof entry === "string") return [entry];
    if (entry === null || typeof entry !== "object") return [];
    return Object.values(entry).flatMap(targets);
}

export function attw(context: StepContext): string {
    const manifest = JSON.parse(read(context, "package.json") ?? "{}") as { exports?: unknown };
    const exportsField = manifest.exports;
    const entries = exportsField !== null && typeof exportsField === "object" && !Array.isArray(exportsField) ? exportsField : {};
    const excluded = Object.entries(entries)
        .filter(
            ([key, entry]) =>
                key.startsWith(".") && targets(entry).length > 0 && targets(entry).every((target) => NOT_A_MODULE.test(target)),
        )
        .map(([key]) => quoted(key));
    return `pnpm exec attw --pack . --profile esm-only${excluded.length === 0 ? "" : ` --exclude-entrypoints ${excluded.join(" ")}`}`;
}

export function consumerApp(context: StepContext): string | null {
    const manifest = read(context, `${CONSUMER}/app/package.json`);
    if (manifest === null || !has(context, `${CONSUMER}/playwright.config.ts`)) return null;
    const { scripts } = JSON.parse(manifest) as { scripts?: Record<string, string> };
    return consumerAppCommand(scripts?.["build"] === undefined ? "pnpm exec vite build --logLevel warn" : "pnpm run build");
}

const after = [PNPM_INSTALL];

export const librarySteps: readonly Step[] = [
    {
        id: "stories",
        title: "stories as tests with axe (vitest project stories, Chromium; 0 tests run fails)",
        profile: "library",
        needs: ["pnpm"],
        after,
        run: stories,
        limitSeconds: 600,
    },
    {
        id: "publint",
        title: "the package as npm publishes it (pnpm pack, publint --strict)",
        profile: "library",
        needs: ["pnpm"],
        after,
        run: PUBLINT,
        limitSeconds: 300,
    },
    {
        id: "attw",
        title: "the package's types resolve for ESM consumers (attw --pack, CSS and JSON entry points left out)",
        profile: "library",
        needs: ["pnpm"],
        after: ["publint"],
        run: attw,
        limitSeconds: 300,
    },
    {
        id: "consumer-app",
        title: `the package as an app installs it (pnpm pack, ${CONSUMER}/app builds with the tarball, playwright)`,
        profile: "library",
        needs: ["pnpm", "node"],
        after: ["attw"],
        run: consumerApp,
        limitSeconds: 900,
    },
    {
        id: "visual",
        title: "visual regression of every story (storybook build, playwright in the image of the installed version)",
        profile: "library",
        needs: ["pnpm", "docker"],
        after,
        run: visual,
        limitSeconds: 900,
    },
    {
        id: "changeset",
        title: "a changeset for a change of the package since master (changeset status)",
        profile: "library",
        needs: ["pnpm"],
        after,
        run: CHANGESET,
        limitSeconds: 120,
    },
];
