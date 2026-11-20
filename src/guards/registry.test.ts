import { describe, expect, it } from "vitest";

import { PROFILES } from "../gate/contract.ts";
import { guards } from "./index.ts";
import { isPath } from "./repository/docsPaths.ts";

describe("the registry of guards", () => {
    it("gives every guard a unique kebab-case id that cannot be mistaken for a .NET guard's", () => {
        const ids = guards.map((guard) => guard.id);

        expect(ids.filter((id) => !/^[a-z][a-z0-9-]*$/.test(id))).toEqual([]);
        expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    it("gives no guard an id that docs-paths would read as a path", () => {
        expect(guards.map((guard) => guard.id).filter(isPath)).toEqual([]);
    });

    it("names only real profiles and describes every guard", () => {
        expect(
            guards
                .filter(
                    (guard) =>
                        guard.description.trim() === "" ||
                        (guard.profiles !== "every" && !guard.profiles.every((profile) => PROFILES.includes(profile))),
                )
                .map((guard) => guard.id),
        ).toEqual([]);
    });
});
