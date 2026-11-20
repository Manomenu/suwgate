import { describe, expect, it } from "vitest";

import { justModules } from "./justModules.ts";
import { findingsOf, shown } from "./testRepository.ts";

describe("just-modules", () => {
    it("passes modules beside the justfile and in a tool's folder, each named", async () => {
        const files = { justfile: "mod db\nmod? web\n\ndefault:\n", "db.just": "", "web/mod.just": "" };
        expect(await findingsOf(justModules, files)).toEqual([]);
    });

    it.each([["tools/db/mod.just"], ["tools/db.just"], ["web/tasks.just"]])("finds a module just cannot find by name: %s", async (file) => {
        expect(shown(await findingsOf(justModules, { justfile: "", [file]: "" }))).toEqual([file]);
    });

    it("finds a mod line without its module and a module without its mod line", async () => {
        const findings = await findingsOf(justModules, { justfile: "mod db\n", "web.just": "" });

        expect(findings).toEqual([
            { target: "justfile", message: "mod db has no db.just or db/mod.just: add the module, or delete the mod line" },
            { target: "web.just", message: "the justfile does not load it: add mod web to the justfile, or delete the module" },
        ]);
    });
});
