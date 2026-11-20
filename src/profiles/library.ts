import type { Step } from "../gate/contract.ts";

const CHANGESET = [
    'base=""',
    "if git rev-parse --verify -q origin/master >/dev/null; then base=origin/master; elif git rev-parse --verify -q master >/dev/null; then base=master; fi",
    'if [ -z "$base" ] || [ "$(git rev-parse HEAD 2>/dev/null)" = "$(git rev-parse "$base")" ]; then echo "on $base itself or no master yet: nothing to compare with"; exit 0; fi',
    'pnpm exec changeset status --since "$base"',
].join("\n");

const PUBLINT = [
    'work="$(mktemp -d)"',
    "trap 'rm -rf \"$work\"' EXIT",
    'pnpm pack --pack-destination "$work" >/dev/null',
    'pnpm exec publint "$work"/*.tgz --strict',
].join("\n");

export const librarySteps: readonly Step[] = [
    {
        id: "publint",
        title: "the package as npm publishes it (pnpm pack, publint --strict)",
        profile: "library",
        needs: ["pnpm"],
        run: PUBLINT,
        limitSeconds: 300,
    },
    {
        id: "attw",
        title: "the package's types resolve for ESM consumers (attw --pack)",
        profile: "library",
        needs: ["pnpm"],
        run: "pnpm exec attw --pack . --profile esm-only",
        limitSeconds: 300,
    },
    {
        id: "changeset",
        title: "a changeset for a change of the package since master (changeset status)",
        profile: "library",
        needs: ["pnpm"],
        run: CHANGESET,
        limitSeconds: 120,
    },
];
