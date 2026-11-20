import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scriptsHelp } from "./scriptsHelp.ts";
import { gitRepository, shown } from "./testRepository.ts";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function check(files: Record<string, string>) {
    const root = gitRepository(files);
    roots.push(root);
    const findings = await scriptsHelp.check({
        root,
        files: Object.keys(files),
        profiles: ["web"],
        directories: {},
        exceptions: [],
        settings: undefined,
        read: (file) => readFileSync(path.join(root, file), "utf8"),
    });
    return { root, findings };
}

describe("scripts-help", () => {
    it("passes a script that prints its usage on --help", async () => {
        const script = '#!/usr/bin/env bash\nif [ "${1:-}" = --help ]; then echo "usage: db.sh up|down"; exit 0; fi\ntouch ran\n';
        const { findings } = await check({ "scripts/db.sh": script });
        expect(findings).toEqual([]);
    });

    it("never runs a script that does not mention --help or a usage text", async () => {
        const { root, findings } = await check({ "scripts/db.sh": "#!/usr/bin/env bash\ntouch ran\n" });

        expect(shown(findings)).toEqual(["scripts/db.sh"]);
        expect(findings[0]?.message).toContain("print a usage text on --help");
        expect(() => readFileSync(path.join(root, "ran"))).toThrow();
    });

    it("finds a script whose --help prints nothing", async () => {
        const { findings } = await check({ "scripts/db.sh": '#!/usr/bin/env bash\n[ "${1:-}" = --help ] && exit 0\n' });
        expect(findings[0]?.message).toContain("--help printed nothing");
    });

    it("leaves the hooks alone, which read their input from Claude Code", async () => {
        const { findings } = await check({ "scripts/hook-stop.sh": "#!/usr/bin/env bash\ncat >/dev/null\n" });
        expect(findings).toEqual([]);
    });
});
