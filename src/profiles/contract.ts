import { existsSync } from "node:fs";
import path from "node:path";

import type { Step, StepContext } from "../gate/contract.ts";
import { DOTNET_TEST, NO_IDLE_BUILD_PROCESSES } from "./dotnet.ts";
import { PNPM_INSTALL } from "./node.ts";
import { has, quoted, read, script, settingsOf, tracked } from "./shell.ts";

const DEFAULT_CONTRACT = "contract/openapi.json";

const API_VERSION_STEP = "api-version";

interface ContractSettings {
    contract: string;
}

interface VersionSettings {
    breaking: "major" | "never";
}

const CONTRACT_SETTINGS = {
    type: "object",
    additionalProperties: false,
    properties: {
        contract: {
            description:
                "Where the API contract is, relative to the dotnet directory (default contract/openapi.json); api-version compares the same file, and reads its version from the package.json beside it.",
            type: "string",
            pattern: "^[A-Za-z0-9._-][A-Za-z0-9._/-]*\\.json$",
        },
    },
};

const VERSION_SETTINGS = {
    type: "object",
    additionalProperties: false,
    properties: {
        breaking: {
            description:
                "major (default): a breaking change of the contract needs a new major version in the package.json beside it; never: every breaking change fails, whatever the version.",
            enum: ["major", "never"],
        },
    },
};

function contractOf(context: StepContext): string {
    return settingsOf<ContractSettings>(context, API_CONTRACT).contract ?? DEFAULT_CONTRACT;
}

function versionFileOf(contract: string): string {
    return path.posix.join(path.posix.dirname(contract), "package.json");
}

export const API_TYPES = "src/api/openapi.d.ts";

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
    return existsSync(path.join(directory, API_TYPES)) ? directory : null;
}

export interface ApiLayout {
    cwd: string;
    contract: string;
    server: string;
    name: string;
    web: string | null;
}

export interface ApiProblem {
    problem: string;
}

function discoverApi(context: StepContext): ApiLayout | ApiProblem {
    const contract = contractOf(context);
    const servers = tracked(context, ["*.csproj"]).filter((project) => (read(context, project) ?? "").includes(GENERATOR));
    const [server, ...others] = servers;
    if (server === undefined) return { problem: `no project writes ${contract}: reference ${GENERATOR} in the server's project` };
    if (others.length > 0) {
        return {
            problem: `${contract} has more than one project that could write it (${servers.join(", ")}): keep ${GENERATOR} in the server's project only`,
        };
    }
    return { cwd: context.cwd, contract, server, name: path.basename(server, ".csproj"), web: webApp(context) };
}

export interface ApiRepository {
    root: string;
    profiles: StepContext["profiles"];
    directories: StepContext["directories"];
    contractSettings: unknown;
}

export function discoverApiIn(repository: ApiRepository): ApiLayout | ApiProblem {
    const settings = repository.contractSettings === undefined ? {} : { [API_CONTRACT]: repository.contractSettings };
    return discoverApi({
        root: repository.root,
        cwd: path.join(repository.root, repository.directories.dotnet ?? ""),
        quick: false,
        profiles: repository.profiles,
        directories: repository.directories,
        skippedSteps: [],
        skippedGuards: [],
        settings,
        changed: () => [],
    });
}

export function apiContract(context: StepContext): string | null {
    if (!has(context, contractOf(context))) return null;
    const found = discoverApi(context);
    if ("problem" in found) return fail(found.problem);
    const { contract, server, name, web } = found;
    const document = `"$work"/${quoted(`${name}.json`)}`;
    const types = web === null ? "" : path.join(web, API_TYPES);
    return script([
        NO_IDLE_BUILD_PROCESSES,
        'work="$(mktemp -d)"',
        "trap 'rm -rf \"$work\"' EXIT",
        `rm -f ${quoted(path.join(path.dirname(server), "obj", `${name}.OpenApiFiles.cache`))}`,
        `dotnet build ${quoted(server)} --nologo -v quiet -p:OpenApiGenerateDocumentsOnBuild=true -p:OpenApiDocumentsDirectory="$work" >"$work/build.log" || { cat "$work/build.log" >&2; exit 1; }`,
        "stale=()",
        `diff -q ${document} ${contract} >/dev/null 2>&1 || stale+=(${quoted(path.relative(context.root, path.join(context.cwd, contract)))})`,
        ...(web === null
            ? []
            : [
                  `digest="$(sha256sum ${document} | cut -d' ' -f1)"`,
                  `(cd ${quoted(web)} && pnpm exec openapi-typescript ${document} --output "$work/schema.d.ts" >/dev/null)`,
                  `if ! head -n 1 ${quoted(types)} | grep -q "sha256 $digest" || ! tail -n +2 ${quoted(types)} | diff -q - "$work/schema.d.ts" >/dev/null; then stale+=(${quoted(path.relative(context.root, types))}); fi`,
              ]),
        'if [ ${#stale[@]} -gt 0 ]; then echo "${stale[*]} out of date with the server\'s API — regenerate them (suwgate dev api-types)" >&2; exit 1; fi',
        `echo "API contract${web === null ? "" : " and types"} up to date"`,
    ]);
}

function apiVersionScript(contract: string, breaking: VersionSettings["breaking"]): string {
    const versionFile = versionFileOf(contract);
    const breakingAllowed =
        breaking === "never"
            ? [
                  `    echo "the API contract breaks consumers (see above), and this repository allows no break (api-version breaking: never in suwgate.yml): keep the old shape and add the new one beside it." >&2`,
                  "    exit 1",
              ]
            : [
                  '    if [ -n "$was" ] && [ "${now%%.*}" -gt "${was%%.*}" ]; then',
                  '        echo "API contract breaks consumers since $base (see above), as the new major version $now: every consumer moves to it on purpose."',
                  "        exit 0",
                  "    fi",
                  `    echo "the API contract breaks consumers (see above). Keep the old shape and add the new one beside it, or, agreed with every consumer, raise the major version in ${versionFile}." >&2`,
                  "    exit 1",
              ];
    return script([
        'if ! git rev-parse --verify -q master >/dev/null && ! git rev-parse --verify -q origin/master >/dev/null; then echo "no master yet: nothing to compare the contract with"; exit 0; fi',
        "if git show-ref --verify --quiet refs/heads/master; then base=master; else base=origin/master; fi",
        'work="$(mktemp -d)"',
        "trap 'rm -rf \"$work\"' EXIT",
        `if ! git show "$base:./${contract}" >"$work/base.json" 2>/dev/null; then echo "no ${contract} on $base yet; nothing to compare against."; exit 0; fi`,
        `if git diff --quiet --no-index "$work/base.json" ${contract} 2>/dev/null; then echo "API contract unchanged since $base"; exit 0; fi`,
        `if ! oasdiff breaking "$work/base.json" ${contract} >"$work/load.log" 2>&1; then cat "$work/load.log" >&2; echo "oasdiff could not compare the documents (see above); is ${contract} valid JSON? Regenerate it (suwgate dev api-types)" >&2; exit 1; fi`,
        `version_of() { node -e 'let text = ""; process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => console.log(JSON.parse(text).version));'; }`,
        `now="$(version_of <${versionFile} 2>/dev/null || true)"`,
        `was="$(git show "$base:./${versionFile}" 2>/dev/null | version_of 2>/dev/null || true)"`,
        `version_is_higher() { [ "$1" != "$2" ] && [ "$(printf '%s\\n%s\\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]; }`,
        `if oasdiff breaking "$work/base.json" ${contract} --fail-on ERR; then`,
        '    if [ -n "$was" ] && ! version_is_higher "$now" "$was"; then',
        `        echo "the API contract changed since $base, but ${versionFile} still says $now. Raise its minor version (a compatible change), so a consumer can pin the new one." >&2`,
        "        exit 1",
        "    fi",
        '    echo "API contract changed since $base, compatibly (nothing breaks a consumer), as version $now"',
        "else",
        ...breakingAllowed,
        "fi",
    ]);
}

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
        title: `the API contract and the web app's types up to date with the server (${DEFAULT_CONTRACT} or settings.contract, ${API_TYPES}, openapi-typescript)`,
        profile: "dotnet",
        needs: ["dotnet"],
        after: [DOTNET_TEST, PNPM_INSTALL],
        run: apiContract,
        settingsSchema: CONTRACT_SETTINGS,
        limitSeconds: 300,
    },
    {
        id: API_VERSION_STEP,
        title: "the API contract's version right for what changed since master (the package.json beside the contract, oasdiff breaking)",
        profile: "dotnet",
        needs: ["oasdiff", "node"],
        after: [API_CONTRACT],
        run: (context) =>
            has(context, contractOf(context))
                ? apiVersionScript(contractOf(context), settingsOf<VersionSettings>(context, API_VERSION_STEP).breaking ?? "major")
                : null,
        settingsSchema: VERSION_SETTINGS,
        limitSeconds: 60,
    },
    {
        id: "contract-pins",
        title: "the tests that pin another repository's contract name a version (contract <name>@<version>)",
        run: contractPins,
        limitSeconds: 60,
    },
];
