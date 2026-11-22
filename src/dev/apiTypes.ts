import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Failure, UsageError, type Exec, type Io } from "./process.ts";

export const API_TYPES_USAGE = `usage: suwgate dev api-types
Regenerates the API contract and the web app's TypeScript types from the server, the same way the api-contract step of
suwgate check generates them to compare, so the two cannot disagree. The contract is where settings.contract of api-contract
says (default contract/openapi.json, relative to directories.dotnet); the server is the one project that references
Microsoft.Extensions.ApiDescription.Server; the web app is directories.web when it has src/api/openapi.d.ts.
It deletes the server's obj/<Name>.OpenApiFiles.cache, builds the server so that the build writes the document (no database
needed; the build log is printed when it fails), copies the document to the contract path, and, with a web app, runs
openapi-typescript (pnpm install --frozen-lockfile first when node_modules is missing) and writes src/api/openapi.d.ts with a
first line naming the contract and its sha256. Prints the paths written, one per line, relative to the repository root.`;

export interface ApiLayout {
    cwd: string;
    contract: string;
    server: string;
    name: string;
    web: string | null;
}

export type ApiDiscovery = { root: string; layout: ApiLayout } | { problem: string };

export type DiscoverApi = (cwd: string) => ApiDiscovery;

export const API_TYPES_FILE = "src/api/openapi.d.ts";

export interface ApiTypesEnvironment {
    root: string;
    layout: ApiLayout;
    exec: Exec;
    io: Io;
}

export function parseApiTypes(args: readonly string[]): void {
    if (args.length > 0) throw new UsageError(`suwgate dev api-types takes no arguments\n${API_TYPES_USAGE}`);
}

export function typesHeader(contract: string, digest: string): string {
    return `// Generated from ${contract} (sha256 ${digest}) by suwgate dev api-types; never edit.`;
}

async function buildDocument(layout: ApiLayout, work: string, environment: ApiTypesEnvironment): Promise<string> {
    const { exec, io } = environment;
    const server = path.join(layout.cwd, layout.server);
    rmSync(path.join(path.dirname(server), "obj", `${layout.name}.OpenApiFiles.cache`), { force: true });
    const built = await exec(
        [
            "dotnet",
            "build",
            server,
            "--nologo",
            "-v",
            "quiet",
            "-p:OpenApiGenerateDocumentsOnBuild=true",
            `-p:OpenApiDocumentsDirectory=${work}`,
        ],
        { capture: true },
    );
    if (built.status !== 0) {
        io.err(built.stdout);
        throw new Failure(`suwgate dev api-types: dotnet build of ${layout.server} failed (exit ${built.status}), its log is above`);
    }
    const document = path.join(work, `${layout.name}.json`);
    if (!existsSync(document)) {
        throw new Failure(
            `suwgate dev api-types: the build of ${layout.server} wrote no ${layout.name}.json: does ${layout.server} reference Microsoft.Extensions.ApiDescription.Server?`,
        );
    }
    return document;
}

async function generateTypes(web: string, document: string, work: string, exec: Exec, io: Io): Promise<string> {
    if (!existsSync(path.join(web, "node_modules"))) {
        const installed = await exec(["pnpm", "install", "--frozen-lockfile"], { cwd: web });
        if (installed.status !== 0) {
            throw new Failure(`suwgate dev api-types: pnpm install --frozen-lockfile failed in ${web} (exit ${installed.status})`);
        }
    }
    const schema = path.join(work, "schema.d.ts");
    const generated = await exec(["pnpm", "exec", "openapi-typescript", document, "--output", schema], {
        cwd: web,
        capture: true,
    });
    if (generated.status !== 0) {
        io.err(generated.stdout);
        throw new Failure(`suwgate dev api-types: openapi-typescript failed in ${web} (exit ${generated.status}), its output is above`);
    }
    return readFileSync(schema, "utf8");
}

export async function runApiTypes(environment: ApiTypesEnvironment): Promise<number> {
    const { root, layout, exec, io } = environment;
    const work = mkdtempSync(path.join(tmpdir(), "suwgate-api-types-"));
    try {
        const document = await buildDocument(layout, work, environment);
        const contractFile = path.join(layout.cwd, layout.contract);
        const contract = path.relative(root, contractFile).split(path.sep).join("/");
        const written = [contractFile];
        let types: { file: string; text: string } | null = null;
        if (layout.web !== null) {
            const digest = createHash("sha256").update(readFileSync(document)).digest("hex");
            const schema = await generateTypes(layout.web, document, work, exec, io);
            types = { file: path.join(layout.web, API_TYPES_FILE), text: `${typesHeader(contract, digest)}\n${schema}` };
            written.push(types.file);
        }
        mkdirSync(path.dirname(contractFile), { recursive: true });
        copyFileSync(document, contractFile);
        if (types !== null) writeFileSync(types.file, types.text);
        for (const file of written) io.out(path.relative(root, file).split(path.sep).join("/"));
        return 0;
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}
