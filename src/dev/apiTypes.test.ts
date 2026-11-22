import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { API_TYPES_FILE, parseApiTypes, runApiTypes, typesHeader, type ApiLayout } from "./apiTypes.ts";
import { Failure, UsageError } from "./process.ts";
import { fakeExec, recordingIo } from "./testing.ts";

const folders: string[] = [];

const DOCUMENT = '{"openapi":"3.0.1"}';

function repository(): { root: string; layout: ApiLayout } {
    const root = mkdtempSync(path.join(tmpdir(), "suwgate-api-types-test-"));
    folders.push(root);
    mkdirSync(path.join(root, "Myapp.Server/obj"), { recursive: true });
    writeFileSync(path.join(root, "Myapp.Server/obj/Myapp.Server.OpenApiFiles.cache"), "old");
    mkdirSync(path.join(root, "Myapp.Web/src/api"), { recursive: true });
    mkdirSync(path.join(root, "Myapp.Web/node_modules"));
    return {
        root,
        layout: {
            cwd: root,
            contract: "contract/openapi.json",
            server: "Myapp.Server/Myapp.Server.csproj",
            name: "Myapp.Server",
            web: path.join(root, "Myapp.Web"),
        },
    };
}

function generator(argv: readonly string[]): { status?: number; stdout?: string } {
    if (argv[0] === "dotnet") {
        const directory = argv.find((argument) => argument.startsWith("-p:OpenApiDocumentsDirectory="))?.split("=")[1] ?? "";
        writeFileSync(path.join(directory, "Myapp.Server.json"), DOCUMENT);
    }
    const output = argv.indexOf("--output");
    if (output !== -1) writeFileSync(argv[output + 1] ?? "", "export interface paths {}\n");
    return {};
}

afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("dev api-types", () => {
    it("takes no arguments", () => {
        expect(() => parseApiTypes([])).not.toThrow();
        expect(() => parseApiTypes(["now"])).toThrow(UsageError);
    });

    it("builds the server, writes the contract and the types with the digest of the document, and prints the paths", async () => {
        const { root, layout } = repository();
        const { exec, calls } = fakeExec(generator);
        const { io, out } = recordingIo();

        expect(await runApiTypes({ root, layout, exec, io })).toBe(0);

        const digest = createHash("sha256").update(DOCUMENT).digest("hex");
        expect(readFileSync(path.join(root, "contract/openapi.json"), "utf8")).toBe(DOCUMENT);
        expect(readFileSync(path.join(root, "Myapp.Web", API_TYPES_FILE), "utf8")).toBe(
            `${typesHeader("contract/openapi.json", digest)}\nexport interface paths {}\n`,
        );
        expect(out).toEqual(["contract/openapi.json", `Myapp.Web/${API_TYPES_FILE}`]);
        expect(existsSync(path.join(root, "Myapp.Server/obj/Myapp.Server.OpenApiFiles.cache"))).toBe(false);
        expect(calls[0]?.argv.slice(0, 7)).toEqual([
            "dotnet",
            "build",
            path.join(root, "Myapp.Server/Myapp.Server.csproj"),
            "--nologo",
            "-v",
            "quiet",
            "-p:OpenApiGenerateDocumentsOnBuild=true",
        ]);
        expect(calls[1]?.argv.slice(0, 3)).toEqual(["pnpm", "exec", "openapi-typescript"]);
        expect(calls[1]?.options?.cwd).toBe(path.join(root, "Myapp.Web"));
    });

    it("writes only the contract without a web app", async () => {
        const { root, layout } = repository();
        const { exec, calls } = fakeExec(generator);
        const { io, out } = recordingIo();

        expect(await runApiTypes({ root, layout: { ...layout, web: null }, exec, io })).toBe(0);

        expect(out).toEqual(["contract/openapi.json"]);
        expect(calls).toHaveLength(1);
    });

    it("installs the packages of the web app first when node_modules is missing", async () => {
        const { root, layout } = repository();
        rmSync(path.join(root, "Myapp.Web/node_modules"), { recursive: true });
        const { exec, calls } = fakeExec(generator);

        await runApiTypes({ root, layout, exec, io: recordingIo().io });

        expect(calls[1]?.argv).toEqual(["pnpm", "install", "--frozen-lockfile"]);
        expect(calls[2]?.argv[1]).toBe("exec");
    });

    it("prints the build log and fails when the build fails, leaving the contract alone", async () => {
        const { root, layout } = repository();
        const { exec } = fakeExec(() => ({ status: 1, stdout: "error CS1002" }));
        const { io, err } = recordingIo();

        await expect(runApiTypes({ root, layout, exec, io })).rejects.toThrow(Failure);

        expect(err).toEqual(["error CS1002"]);
        expect(existsSync(path.join(root, "contract/openapi.json"))).toBe(false);
    });

    it("fails when the build writes no document", async () => {
        const { root, layout } = repository();
        const { exec } = fakeExec();

        await expect(runApiTypes({ root, layout, exec, io: recordingIo().io })).rejects.toThrow("wrote no Myapp.Server.json");
    });

    it("fails with the output of openapi-typescript when it fails", async () => {
        const { root, layout } = repository();
        const { exec } = fakeExec((argv) => (argv[0] === "pnpm" ? { status: 1, stdout: "bad schema" } : generator(argv)));
        const { io, err } = recordingIo();

        await expect(runApiTypes({ root, layout, exec, io })).rejects.toThrow("openapi-typescript failed");
        expect(err).toEqual(["bad schema"]);
        expect(existsSync(path.join(root, "contract/openapi.json"))).toBe(false);
    });
});
