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
const test: Step = {
    id: "dotnet-test",
    title: "test",
    run: "true",
    after: ["dotnet-build"],
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { excludeTraits: { type: "array", items: { type: "string" } } },
    },
};
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
    stepsFor: (profiles) => (profiles.includes("dotnet") ? [build, test] : []),
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
                configure: {},
                environment: {},
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

describe("steps.configure and env", () => {
    it("loads the knobs of a profile's step, the environment of every step, and a reason shared by more than a hundred aliases", () => {
        const exceptions = Array.from({ length: 120 }, (_, index) => `  - { guard: required-files, target: F${index}, reason: *why }`);
        const loaded = parseConfig(
            [
                "profiles: [dotnet]",
                "env: { CI_LIKE: '1' }",
                "unset: [Models__*]",
                "steps:",
                "  configure:",
                "    dotnet-test:",
                "      limitSeconds: 900",
                "      after: [dotnet-build]",
                "      env: { E2E_X: '1' }",
                "      unset: [LLM_MODEL_*]",
                "      settings: { excludeTraits: [live=true] }",
                "exceptions:",
                "  - { guard: required-files, target: F, reason: &why the owner keeps it elsewhere }",
                ...exceptions,
            ].join("\n"),
            catalog,
        );

        expect("config" in loaded && loaded.config.exceptions.length).toBe(121);
        expect("config" in loaded && loaded.config.exceptions.at(-1)?.reason).toBe("the owner keeps it elsewhere");
        expect("config" in loaded && loaded.config.environment).toEqual({ env: { CI_LIKE: "1" }, unset: ["Models__*"] });
        expect("config" in loaded && loaded.config.configure).toEqual({
            "dotnet-test": {
                limitSeconds: 900,
                after: ["dotnet-build"],
                env: { E2E_X: "1" },
                unset: ["LLM_MODEL_*"],
                settings: { excludeTraits: ["live=true"] },
            },
        });
    });

    it.each([
        [
            "steps:\n  configure:\n    e2e: { limitSeconds: 9 }\n",
            'steps.configure.e2e: the profiles dotnet have no step "e2e": their steps are dotnet-build, dotnet-test',
        ],
        [
            "steps:\n  add:\n    - { name: pack, run: x }\n  configure:\n    pack: { limitSeconds: 9 }\n",
            'steps.configure.pack: "pack" is added in steps.add, which takes its limitSeconds and after itself',
        ],
        [
            "steps:\n  configure:\n    dotnet-build: { settings: { a: 1 } }\n",
            'steps.configure.dotnet-build.settings: the step "dotnet-build" takes no settings',
        ],
        ["steps:\n  configure:\n    dotnet-test: { settings: { traits: [] } }\n", 'has an unknown key "traits"'],
        ["steps:\n  configure:\n    dotnet-test: { after: [nope] }\n", 'no step "nope": the steps are dotnet-build, dotnet-test'],
        [
            "steps:\n  skip:\n    - { step: dotnet-test, reason: r }\n  configure:\n    dotnet-test: { limitSeconds: 9 }\n",
            '"dotnet-test" is skipped in steps.skip, so this configuration is never used',
        ],
        [
            "steps:\n  configure:\n    dotnet-build: { after: [dotnet-test] }\n",
            "steps wait for each other in a circle: dotnet-build -> dotnet-test -> dotnet-build",
        ],
        ["env: { E2E_X: 1 }\n", "env.E2E_X must be string"],
        ["unset: ['Models__[a]']\n", "unset[0] must match pattern"],
    ])("refuses %s", (text, expected) => {
        expect(problems(`profiles: [dotnet]\n${text}`).join("\n")).toContain(expected);
    });
});

describe("exceptions narrowed to one finding, and one-time exceptions", () => {
    it("takes message and once on a repository guard, and a second exception of the same target with another message", () => {
        expect(
            problems(
                [
                    "profiles: [dotnet]",
                    "exceptions:",
                    "  - { guard: required-files, target: X, message: first, once: true, reason: r }",
                    "  - { guard: required-files, target: X, message: second, reason: r }",
                ].join("\n"),
            ),
        ).toEqual([]);
    });

    it("refuses message and once on a .NET guard, whose packages match by target only", () => {
        expect(
            problems("profiles: [dotnet]\nexceptions:\n  - { guard: architecture/layers, target: X, once: true, reason: r }\n")[0],
        ).toContain("the .NET packages match an exception by its target only: delete message and once");
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
