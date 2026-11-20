import type { Step, StepContext } from "../gate/contract.ts";
import { DATABASE_UP } from "./database.ts";
import { requiredGuards } from "./dotnetGuards.ts";
import {
    CHECKOUT_ENV,
    changedIn,
    hasDevSection,
    quoted,
    read,
    runDirectory,
    settingsOf,
    tracked,
    verdictCommand,
    withChanged,
} from "./shell.ts";

const DOTNET_INPUT =
    /\.(cs|csproj|props|targets|slnx|sln|rsp)$|(^|\/)(\.editorconfig|BannedSymbols\.txt|global\.json|packages\.lock\.json|nuget\.config)$/;

const GUARD_PACKAGE = /<(PackageReference|ProjectReference)\b[^>]*(?:Include|Update)="[^"]*Suwgate\.(Architecture|Database)\b/;

const TEST_PROJECT = /<PackageReference\b[^>]*Include="xunit\.v3"|<IsTestProject>true<\/IsTestProject>/;

export const NO_IDLE_BUILD_PROCESSES = "export MSBUILDDISABLENODEREUSE=1 DOTNET_CLI_USE_MSBUILD_SERVER=0";

const BUILD = `${NO_IDLE_BUILD_PROCESSES} && dotnet build --nologo -v quiet`;

const TEST_OPTIONS = '--no-build --no-progress --zero-tests-policy strict --report-xunit-xml --results-directory "$run/results"';

const FORMAT = `${NO_IDLE_BUILD_PROCESSES} && dotnet tool restore >/dev/null`;

export const DOTNET_BUILD = "dotnet-build";

export const DOTNET_TEST = "dotnet-test";

interface DotnetTestSettings {
    excludeTraits: string[];
}

const TRAIT = "^[^=\\s]+=[^=\\s]+$";

const DOTNET_TEST_SETTINGS = {
    type: "object",
    additionalProperties: false,
    properties: {
        excludeTraits: {
            description:
                "Traits (name=value) of the tests outside the gate, e.g. live=true for tests that call a real model: dotnet-test leaves them out (--filter-not-trait), and criteria-ran says so when a criterion is named only by them.",
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", pattern: TRAIT },
        },
    },
};

export function excludedTraits(context: StepContext): string[] {
    return settingsOf<DotnetTestSettings>(context, DOTNET_TEST).excludeTraits ?? [];
}

function testOptions(context: StepContext): string {
    const traits = excludedTraits(context);
    return traits.length === 0 ? TEST_OPTIONS : `${TEST_OPTIONS} --filter-not-trait ${traits.map(quoted).join(" ")}`;
}

function dotnetChanged(context: StepContext): boolean {
    return changedIn(context, DOTNET_INPUT).length > 0;
}

export function inCheckoutEnv(context: StepContext, command: string): string {
    if (!hasDevSection(context)) return `${NO_IDLE_BUILD_PROCESSES} && ${command}`;
    return [...CHECKOUT_ENV, command].join(" && ");
}

export function guardTests(context: StepContext): string | null {
    if (!dotnetChanged(context)) return null;
    const projects = tracked(context, ["*.csproj"]).filter((project) => {
        const text = read(context, project) ?? "";
        return GUARD_PACKAGE.test(text) && TEST_PROJECT.test(text);
    });
    if (projects.length === 0) return null;
    return projects.map((project) => `dotnet test --project ${quoted(project)} ${testOptions(context)}`).join(" && ");
}

export function witnessed(context: StepContext, tests: string): string {
    return [
        runDirectory(DOTNET_TEST),
        'export SUWGATE_EVIDENCE="$run/evidence"',
        tests,
        verdictCommand(`tests xunit "$run/results" ${quoted("dotnet test")}`),
        `{ [ $# -gt 0 ] || ${verdictCommand(`guards "$run/evidence" ${requiredGuards(context).map(quoted).join(" ")}`)}; }`,
    ].join(" && ");
}

export const dotnetSteps: readonly Step[] = [
    {
        id: DOTNET_BUILD,
        title: "build (compiler, analyzers, banned APIs, NuGet audit)",
        profile: "dotnet",
        needs: ["dotnet"],
        run: BUILD,
        quick: (context) => (dotnetChanged(context) ? BUILD : null),
        limitSeconds: 300,
    },
    {
        id: "dotnet-format",
        title: "format C# (csharpier check)",
        profile: "dotnet",
        needs: ["dotnet"],
        run: `${FORMAT} && dotnet csharpier check .`,
        quick: (context) => {
            const command = withChanged(context, /\.cs$/, "dotnet csharpier check");
            return command === null ? null : `${FORMAT} && ${command}`;
        },
        limitSeconds: 120,
    },
    {
        id: DOTNET_TEST,
        title: "tests (dotnet test, xUnit v3, with the checkout's databases when suwgate.yml has dev; fails on 0 tests run and, without arguments, unless every .NET guard of the profiles ran; --quick: the projects that test with Suwgate.Architecture or Suwgate.Database)",
        profile: "dotnet",
        needs: ["dotnet"],
        after: [DOTNET_BUILD, DATABASE_UP],
        run: (context) => inCheckoutEnv(context, witnessed(context, `dotnet test ${testOptions(context)} "$@"`)),
        quick: (context) => {
            const command = guardTests(context);
            return command === null ? null : inCheckoutEnv(context, witnessed(context, command));
        },
        args: "dotnet test, xUnit v3 on Microsoft.Testing.Platform",
        settingsSchema: DOTNET_TEST_SETTINGS,
        limitSeconds: 600,
    },
];
