import { describe, expect, it } from "vitest";

import { parseConfig, type Catalog } from "./config.ts";
import type { Guard, Step } from "./contract.ts";

const lonelyInterfaces: Guard = { id: "required-files", description: "", profiles: "every", check: () => [] };
const webOnly: Guard = { id: "web-only", description: "", profiles: ["web"], check: () => [] };
const withSettings: Guard = {
    id: "with-settings",
    description: "",
    profiles: "every",
    settingsSchema: { type: "object", additionalProperties: false, properties: { files: { type: "array", items: { type: "string" } } } },
    check: () => [],
};
const build: Step = { id: "dotnet-build", title: "build", run: "true" };
const catalog: Catalog = {
    guards: [lonelyInterfaces, webOnly, withSettings],
    dotnetGuards: [
        { id: "architecture/layers", profile: "dotnet" },
        {
            id: "database/migration-script-names",
            profile: "database",
            settingsSchema: { type: "object", additionalProperties: false, properties: { directory: { type: "string" } } },
        },
    ],
    stepsFor: (profiles) => (profiles.includes("dotnet") ? [build] : []),
};

function problems(text: string): string[] {
    const loaded = parseConfig(text, catalog);
    return "problems" in loaded ? loaded.problems : [];
}

describe("a valid suwgate.yml", () => {
    it("loads profiles in the canonical order, steps, exceptions and settings", () => {
        const loaded = parseConfig(
            [
                "profiles: [dotnet, library]",
                "steps:",
                "  add:",
                "    - { name: pack, run: dotnet pack, after: [dotnet-build] }",
                "  skip:",
                "    - { step: dotnet-build, reason: built by the pack step }",
                "exceptions:",
                "  - { guard: required-files, target: LICENSE, reason: the owner keeps the licence in the README }",
                "  - { guard: architecture/interfaces, target: Sdk.IClock, reason: the SDK asks for it }",
                "guards:",
                "  skip:",
                "    - { guard: architecture/layers, reason: a library has no layers }",
                "settings:",
                "  with-settings: { files: [NOTICE] }",
            ].join("\n"),
            catalog,
        );

        expect(loaded).toEqual({
            config: {
                profiles: ["library", "dotnet"],
                directories: {},
                add: [{ name: "pack", run: "dotnet pack", after: ["dotnet-build"] }],
                skip: [{ step: "dotnet-build", reason: "built by the pack step" }],
                skippedGuards: [{ guard: "architecture/layers", reason: "a library has no layers" }],
                exceptions: [
                    { guard: "required-files", target: "LICENSE", reason: "the owner keeps the licence in the README" },
                    { guard: "architecture/interfaces", target: "Sdk.IClock", reason: "the SDK asks for it" },
                ],
                settings: { "with-settings": { files: ["NOTICE"] } },
            },
        });
    });
});

describe("an invalid suwgate.yml is refused with the line and the fix", () => {
    it.each([
        [
            "profiles: [web]\nexceptions:\n  - guard: web-only\n    target: src/x.ts\n",
            'suwgate.yml:3:5: exceptions[0] has no "reason": every exception says why (reason: <why>)',
        ],
        [
            "profiles: [web]\nexceptions:\n  - { guard: web-only, target: x, reason: '  ' }\n",
            "suwgate.yml:3:43: exceptions[0].reason is empty: say why, in a sentence a reviewer can judge",
        ],
        [
            "profiles: [dotnet]\nsteps:\n  skip:\n    - step: dotnet-build\n",
            'suwgate.yml:4:7: steps.skip[0] has no "reason": every skipped step says why (reason: <why>)',
        ],
        ["profiles: [mobile]\n", 'suwgate.yml:1:12: profiles[0] must be one of ["web","library","dotnet","database"]'],
        ["profile: [web]\n", 'suwgate.yml:1:1: the file has no "profiles"'],
        [
            "profiles: [web]\nexeptions: []\n",
            'suwgate.yml:1:1: the file has an unknown key "exeptions": check its spelling against the schema',
        ],
        ["profiles: [web]\nprofiles: [dotnet]\n", "suwgate.yml:2:1: Map keys must be unique"],
    ])("%#", (text, expected) => {
        expect(problems(text)).toContain(expected);
    });

    it("names an unknown guard and lists the known ones", () => {
        expect(problems("profiles: [web]\nexceptions:\n  - { guard: interfaces, target: X, reason: r }\n")).toEqual([
            'suwgate.yml:3:5: exceptions[0]: no guard "interfaces": the guards are required-files, web-only, with-settings (and architecture/*, database/* of the .NET packages)',
        ]);
    });

    it("refuses an exception from a guard the profiles do not run", () => {
        expect(problems("profiles: [dotnet]\nexceptions:\n  - { guard: web-only, target: X, reason: r }\n")[0]).toContain(
            '"web-only" runs only for web, which this repository does not have: delete the exception',
        );
        expect(problems("profiles: [web]\nexceptions:\n  - { guard: database/migration-names, target: X, reason: r }\n")[0]).toContain(
            '"database/migration-names" is a guard of the database profile',
        );
    });

    it("lets a whole guard be skipped only with a reason, once, when the profiles run it", () => {
        expect(problems("profiles: [dotnet]\nguards:\n  skip:\n    - guard: architecture/layers\n")).toContain(
            'suwgate.yml:4:7: guards.skip[0] has no "reason": every skipped guard says why (reason: <why>)',
        );
        expect(problems("profiles: [dotnet]\nguards:\n  skip:\n    - { guard: architecture/layer, reason: r }\n")[0]).toContain(
            'no guard "architecture/layer": the guards are required-files, web-only, with-settings, architecture/layers, database/migration-script-names',
        );
        expect(
            problems("profiles: [dotnet]\nguards:\n  skip:\n    - { guard: database/migration-script-names, reason: r }\n")[0],
        ).toContain('"database/migration-script-names" runs only for database, which this repository does not have: delete the entry');
        expect(
            problems("profiles: [web]\nguards:\n  skip:\n    - { guard: web-only, reason: r }\n    - { guard: web-only, reason: s }\n")[0],
        ).toContain('"web-only" is skipped twice');
        expect(
            problems(
                "profiles: [web]\nguards:\n  skip:\n    - { guard: web-only, reason: r }\nexceptions:\n  - { guard: web-only, target: X, reason: r }\n",
            )[0],
        ).toContain('"web-only" is skipped in guards.skip, so this exception is never checked');
        expect(problems("profiles: [dotnet]\nguards:\n  skip:\n    - { guard: architecture/layers, reason: r }\n")).toEqual([]);
    });

    it("checks the settings of a .NET guard with its schema", () => {
        expect(problems("profiles: [dotnet, database]\nsettings:\n  database/migration-script-names: { directory: sql/up }\n")).toEqual([]);
        expect(problems("profiles: [dotnet, database]\nsettings:\n  database/migration-script-names: { folder: sql/up }\n")[0]).toContain(
            'has an unknown key "folder"',
        );
    });

    it("refuses the same exception twice", () => {
        expect(
            problems(
                "profiles: [web]\nexceptions:\n  - { guard: web-only, target: X, reason: r }\n  - { guard: web-only, target: X, reason: s }\n",
            )[0],
        ).toContain("is listed twice");
    });

    it("refuses skipping a step the profiles do not have, and adding one they have", () => {
        expect(problems("profiles: [web]\nsteps:\n  skip:\n    - { step: dotnet-build, reason: r }\n")[0]).toContain(
            'the profiles web have no step "dotnet-build"',
        );
        expect(problems("profiles: [dotnet]\nsteps:\n  add:\n    - { name: dotnet-build, run: x }\n")[0]).toContain(
            'the profiles already have a step "dotnet-build"',
        );
        expect(problems("profiles: [dotnet]\nsteps:\n  add:\n    - { name: pack, run: x, after: [build] }\n")[0]).toContain(
            'no step "build"',
        );
    });

    it("checks a guard's settings with the guard's schema", () => {
        expect(problems("profiles: [web]\nsettings:\n  with-settings: { file: [x] }\n")[0]).toContain(
            'settings.with-settings has an unknown key "file"',
        );
        expect(problems("profiles: [web]\nsettings:\n  web-only: {}\n")[0]).toContain('the guard "web-only" takes no settings');
    });

    it("refuses a directory for a profile the repository does not have", () => {
        expect(problems("profiles: [dotnet]\ndirectories:\n  web: Myapp.Web\n")[0]).toContain(
            '"web" is not one of this repository\'s profiles',
        );
    });
});
