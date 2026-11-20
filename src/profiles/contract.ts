import { existsSync } from "node:fs";
import path from "node:path";

import type { Step, StepContext } from "../gate/contract.ts";
import { DOTNET_TEST } from "./dotnet.ts";
import { PNPM_INSTALL } from "./node.ts";
import { has, quoted, read, script, tracked } from "./shell.ts";

const CONTRACT = "contract/openapi.json";

const CONTRACT_VERSION = "contract/package.json";

const TYPES = "src/api/openapi.d.ts";

export const API_CONTRACT = "api-contract";

const GENERATOR = "Microsoft.Extensions.ApiDescription.Server";

const TAGGED = ["*.cs", "*.test.ts", "*.test.tsx", "*.e2e.ts"];

const TRAIT_TAG = /"contract"\s*,\s*"([^"@]+@[^"]+)"/;

const TITLE_TAG = /["'`]contract ([^ :@"'`]+@[^ :"'`]+)/;

const PINNED_VERSION = /^[^@]+@v?\d+(\.\d+){0,2}$/;

function fail(message: string): string {
    return `echo ${quoted(message)} >&2; exit 1`;
}

function webApp(context: StepContext): string | null {
    if (!context.profiles.includes("web")) return null;
    const directory = path.join(context.root, context.directories.web ?? "");
    return existsSync(path.join(directory, TYPES)) ? directory : null;
}

export function apiContract(context: StepContext): string | null {
    if (!has(context, CONTRACT)) return null;
    const servers = tracked(context, ["*.csproj"]).filter((project) => (read(context, project) ?? "").includes(GENERATOR));
    const [server, ...others] = servers;
    if (server === undefined) return fail(`${CONTRACT} is there, but no project writes it: reference ${GENERATOR} in the server's project`);
    if (others.length > 0)
        return fail(
            `${CONTRACT} has more than one project that could write it (${servers.join(", ")}): keep ${GENERATOR} in the server's project only`,
        );
    const name = path.basename(server, ".csproj");
    const document = `"$work"/${quoted(`${name}.json`)}`;
    const web = webApp(context);
    const types = web === null ? "" : path.join(web, TYPES);
    return script([
        'work="$(mktemp -d)"',
        "trap 'rm -rf \"$work\"' EXIT",
        `rm -f ${quoted(path.join(path.dirname(server), "obj", `${name}.OpenApiFiles.cache`))}`,
        `dotnet build ${quoted(server)} --nologo -v quiet -p:OpenApiGenerateDocumentsOnBuild=true -p:OpenApiDocumentsDirectory="$work" >"$work/build.log" || { cat "$work/build.log" >&2; exit 1; }`,
        "stale=()",
        `diff -q ${document} ${CONTRACT} >/dev/null 2>&1 || stale+=(${quoted(path.relative(context.root, path.join(context.cwd, CONTRACT)))})`,
        ...(web === null
            ? []
            : [
                  `digest="$(sha256sum ${document} | cut -d' ' -f1)"`,
                  `(cd ${quoted(web)} && pnpm exec openapi-typescript ${document} --output "$work/schema.d.ts" >/dev/null)`,
                  `if ! head -n 1 ${quoted(types)} | grep -q "sha256 $digest" || ! tail -n +2 ${quoted(types)} | diff -q - "$work/schema.d.ts" >/dev/null; then stale+=(${quoted(path.relative(context.root, types))}); fi`,
              ]),
        'if [ ${#stale[@]} -gt 0 ]; then echo "${stale[*]} out of date with the server\'s API — regenerate them (just api-types)" >&2; exit 1; fi',
        `echo "API contract${web === null ? "" : " and types"} up to date"`,
    ]);
}

const API_VERSION = script([
    'if ! git rev-parse --verify -q master >/dev/null && ! git rev-parse --verify -q origin/master >/dev/null; then echo "no master yet: nothing to compare the contract with"; exit 0; fi',
    "if git show-ref --verify --quiet refs/heads/master; then base=master; else base=origin/master; fi",
    'work="$(mktemp -d)"',
    "trap 'rm -rf \"$work\"' EXIT",
    `if ! git show "$base:./${CONTRACT}" >"$work/base.json" 2>/dev/null; then echo "no ${CONTRACT} on $base yet; nothing to compare against."; exit 0; fi`,
    `if git diff --quiet --no-index "$work/base.json" ${CONTRACT} 2>/dev/null; then echo "API contract unchanged since $base"; exit 0; fi`,
    `if ! oasdiff breaking "$work/base.json" ${CONTRACT} >"$work/load.log" 2>&1; then cat "$work/load.log" >&2; echo "oasdiff could not compare the documents (see above); is ${CONTRACT} valid JSON? Regenerate it (just api-types)" >&2; exit 1; fi`,
    `version_of() { node -e 'let text = ""; process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => console.log(JSON.parse(text).version));'; }`,
    `now="$(version_of <${CONTRACT_VERSION})"`,
    `was="$(git show "$base:./${CONTRACT_VERSION}" 2>/dev/null | version_of 2>/dev/null || true)"`,
    `version_is_higher() { [ "$1" != "$2" ] && [ "$(printf '%s\\n%s\\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]; }`,
    `if oasdiff breaking "$work/base.json" ${CONTRACT} --fail-on ERR; then`,
    '    if [ -n "$was" ] && ! version_is_higher "$now" "$was"; then',
    `        echo "the API contract changed since $base, but ${CONTRACT_VERSION} still says $now. Raise its minor version (a compatible change), so a consumer can pin the new one." >&2`,
    "        exit 1",
    "    fi",
    '    echo "API contract changed since $base, compatibly (nothing breaks a consumer), as version $now"',
    "else",
    '    if [ -n "$was" ] && [ "${now%%.*}" -gt "${was%%.*}" ]; then',
    '        echo "API contract breaks consumers since $base (see above), as the new major version $now: every consumer moves to it on purpose."',
    "        exit 0",
    "    fi",
    `    echo "the API contract breaks consumers (see above). Keep the old shape and add the new one beside it, or, agreed with every consumer, raise the major version in ${CONTRACT_VERSION}." >&2`,
    "    exit 1",
    "fi",
]);

interface Pin {
    tag: string;
    where: string;
}

function pins(context: StepContext): Pin[] {
    return tracked({ ...context, cwd: context.root }, TAGGED).flatMap((file) =>
        (read({ ...context, cwd: context.root }, file) ?? "").split("\n").flatMap((line, index) => {
            const tag = TRAIT_TAG.exec(line)?.[1] ?? TITLE_TAG.exec(line)?.[1];
            return tag === undefined ? [] : [{ tag, where: `${file}:${index + 1}` }];
        }),
    );
}

export function contractPins(context: StepContext): string | null {
    const found = pins(context);
    if (found.length === 0) return null;
    const malformed = found.filter((pin) => !PINNED_VERSION.test(pin.tag));
    const lines = [
        ...found.map((pin) => `${pin.tag.padEnd(24)} ${pin.where}`),
        ...malformed.map(
            (pin) =>
                `${pin.where}: the contract tag ${pin.tag} pins no version: write <contract>@v<major> or <contract>@<major>.<minor>.<patch>, the version the test adapts to`,
        ),
    ];
    return `printf '%s\\n' ${lines.map(quoted).join(" ")}${malformed.length === 0 ? "" : "; exit 1"}`;
}

export const contractSteps: readonly Step[] = [
    {
        id: API_CONTRACT,
        title: `the API contract and the web app's types up to date with the server (${CONTRACT}, ${TYPES}, openapi-typescript)`,
        profile: "dotnet",
        needs: ["dotnet"],
        after: [DOTNET_TEST, PNPM_INSTALL],
        run: apiContract,
        limitSeconds: 300,
    },
    {
        id: "api-version",
        title: `the API contract's version right for what changed since master (${CONTRACT_VERSION}, oasdiff breaking)`,
        profile: "dotnet",
        needs: ["oasdiff", "node"],
        after: [API_CONTRACT],
        run: (context) => (has(context, CONTRACT) ? API_VERSION : null),
        limitSeconds: 60,
    },
    {
        id: "contract-pins",
        title: "the tests that pin another repository's contract name a version (contract <name>@<version>)",
        run: contractPins,
        limitSeconds: 60,
    },
];
