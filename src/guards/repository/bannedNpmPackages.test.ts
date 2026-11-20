import { describe, expect, it } from "vitest";

import { bannedNpmPackages } from "./bannedNpmPackages.ts";
import { findingsOf, shown } from "./testRepository.ts";

const manifest = (dependencies: Record<string, Record<string, string>>) => JSON.stringify(dependencies, null, 4);

describe("banned-npm-packages", () => {
    it("passes a manifest of allowed packages", async () => {
        const files = { "package.json": manifest({ dependencies: { react: "19.2.0", "@maniumek/suwfrontkit": "1.0.0" } }) };
        expect(await findingsOf(bannedNpmPackages, files)).toEqual([]);
    });

    it("finds a banned package and a package of a banned scope in every dependency group of every manifest", async () => {
        const files = {
            "package.json": manifest({ dependencies: { lodash: "4.17.21" }, devDependencies: { "@mui/material": "7.0.0" } }),
            "web/package.json": manifest({ peerDependencies: { moment: "2.30.0" }, optionalDependencies: { "lodash.merge": "4.6.2" } }),
        };

        expect(shown(await findingsOf(bannedNpmPackages, files))).toEqual(["lodash:3", "@mui/material:6", "moment:3"]);
    });

    it("says where it is and what to use instead", async () => {
        const [finding] = await findingsOf(bannedNpmPackages, { "web/package.json": manifest({ dependencies: { classnames: "2.5.1" } }) });
        expect(finding?.message).toBe("web/package.json depends on it: remove it and use cn() of @maniumek/suwfrontkit");
    });

    it("takes more banned packages from its settings", async () => {
        const files = { "package.json": manifest({ dependencies: { axios: "1.9.0", "@tanstack/query": "5.0.0" } }) };
        const settings = { packages: { axios: "use fetch", "@tanstack/": "use the kit's data hooks" } };

        expect(shown(await findingsOf(bannedNpmPackages, files, { settings }))).toEqual(["axios:3", "@tanstack/query:4"]);
    });
});
