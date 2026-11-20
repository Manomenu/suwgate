import type { Guard } from "../../gate/contract.ts";
import { msbuildFiles, packagesIn } from "./msbuild.ts";

const AGAINST_A_REAL_THING = "test against the real thing (a real PostgreSQL) or a recorded answer";

const BANNED_NUGET_PACKAGES: Readonly<Record<string, string>> = {
    MediatR: "call the handler explicitly from the endpoint, so that grep finds the call",
    AutoMapper: "write the mapping by hand (a ToNote() method), so that grep finds it",
    Mapster: "write the mapping by hand (a ToNote() method), so that grep finds it",
    Scrutor: "register the services explicitly, no assembly scanning",
    Moq: AGAINST_A_REAL_THING,
    NSubstitute: AGAINST_A_REAL_THING,
    FakeItEasy: AGAINST_A_REAL_THING,
    FluentAssertions: "use xUnit's Assert",
    "Newtonsoft.Json": "use System.Text.Json, the serializer ASP.NET Core is configured with",
    "Microsoft.EntityFrameworkCore": "use Dapper with hand-written SQL",
};

interface Settings {
    packages?: Record<string, string>;
}

function bannedAs(name: string, banned: Readonly<Record<string, string>>): string | undefined {
    const lower = name.toLowerCase();
    const entry = Object.entries(banned).find(([prefix]) => lower === prefix.toLowerCase() || lower.startsWith(`${prefix.toLowerCase()}.`));
    return entry?.[1];
}

export const bannedNugetPackages: Guard = {
    id: "banned-nuget-packages",
    description:
        "No project references or versions a NuGet package that hides calls from grep, mocks the real thing or duplicates the platform",
    profiles: ["dotnet"],
    settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            packages: { type: "object", additionalProperties: { type: "string", minLength: 1 }, propertyNames: { minLength: 1 } },
        },
    },
    check(context) {
        const banned = { ...BANNED_NUGET_PACKAGES, ...((context.settings ?? {}) as Settings).packages };
        const found = new Map<string, { fix: string; files: string[] }>();
        for (const file of msbuildFiles(context)) {
            for (const name of packagesIn(context.read(file), ["PackageReference", "PackageVersion", "GlobalPackageReference"])) {
                const fix = bannedAs(name, banned);
                if (fix !== undefined) {
                    const entry = found.get(name) ?? { fix, files: [] };
                    entry.files.push(file);
                    found.set(name, entry);
                }
            }
        }
        return [...found.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, { fix, files }]) => ({
                target: name,
                message: `banned package (in ${[...new Set(files)].join(", ")}): remove it and ${fix}`,
            }));
    },
};
