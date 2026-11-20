import { describe, expect, it } from "vitest";

import type { GuardContext } from "../../gate/contract.ts";
import { connectionHost } from "./connectionHost.ts";

const NAME = "local" + "host";

function run(files: Record<string, string>) {
    const context: GuardContext = {
        root: "/",
        files: Object.keys(files),
        profiles: ["database"],
        directories: {},
        exceptions: [],
        settings: undefined,
        read: (file) => files[file] ?? "",
    };
    return connectionHost.check(context);
}

describe("connection-host", () => {
    it.each([
        ["an address", "Host=127.0.0.1;Database=app"],
        ["another host", "Host=db.internal;Database=app"],
        ["a word that only contains it", `Hostname=${NAME}`],
    ])("passes %s", async (_name, text) => {
        expect(await run({ "appsettings.json": text })).toEqual([]);
    });

    it.each([["Host=" + NAME], ["host=" + NAME.toUpperCase()], ["Host = " + NAME]])("fails %s with the fix and the line", async (text) => {
        const findings = await run({ "src/Db.cs": `first\n"${text};Database=app"` });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ target: "src/Db.cs", line: 2 });
        expect(findings[0]?.message).toContain("Host=127.0.0.1");
    });

    it("skips lockfiles and file types it does not scan", async () => {
        expect(await run({ "pnpm-lock.yaml": `Host=${NAME}`, "notes.txt": `Host=${NAME}`, "packages.lock.json": `Host=${NAME}` })).toEqual(
            [],
        );
    });
});
