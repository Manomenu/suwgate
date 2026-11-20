import type { DotnetGuard, StepContext } from "../gate/contract.ts";

const ARCHITECTURE = [
    "layers",
    "endpoints",
    "project-references",
    "every-project-guarded",
    "interfaces-have-two-implementations",
    "nothing-obsolete",
    "no-unused-types",
    "forbidden-type-names",
    "unique-type-names",
    "one-type-per-file",
    "no-escape-hatches",
    "no-fixture-in-field",
    "build-settings",
];

export const dotnetGuards: readonly DotnetGuard[] = [
    ...ARCHITECTURE.map((name) => ({ id: `architecture/${name}`, profile: "dotnet" as const })),
    {
        id: "database/migration-script-names",
        profile: "database",
        settingsSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                directory: {
                    type: "string",
                    pattern: "^[^/\\\\][^\\\\]*$",
                    description: "The folder of the NNNN_what_it_does.sql scripts, when it is not the one Migrations/up folder.",
                },
            },
        },
    },
];

export function requiredGuards(context: StepContext): string[] {
    return dotnetGuards
        .filter((guard) => context.profiles.includes(guard.profile) && !context.skippedGuards.includes(guard.id))
        .map((guard) => guard.id);
}
