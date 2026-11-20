import type { Step, StepContext } from "../gate/contract.ts";
import { DATABASE_UP } from "./database.ts";
import { requiredGuards } from "./dotnetGuards.ts";
import { CHECKOUT_ENV, changedIn, hasDevSection, quoted, read, runDirectory, tracked, verdictCommand, withChanged } from "./shell.ts";

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
    return projects.map((project) => `dotnet test --project ${quoted(project)} ${TEST_OPTIONS}`).join(" && ");
}

export function witnessed(context: StepContext, tests: string): string {
    return [
        runDirectory(DOTNET_TEST),
        'export SUWGATE_EVIDENCE="$run/evidence"',
        tests,
        verdictCommand(`tests xunit "$run/results" ${quoted("dotnet test")}`),
        verdictCommand(`guards "$run/evidence" ${requiredGuards(context).map(quoted).join(" ")}`),
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
        title: "tests (dotnet test, xUnit v3, with the checkout's databases when suwgate.yml has dev; fails on 0 tests run and unless every .NET guard of the profiles ran; --quick: the projects that test with Suwgate.Architecture or Suwgate.Database)",
        profile: "dotnet",
        needs: ["dotnet"],
        after: [DOTNET_BUILD, DATABASE_UP],
        run: (context) => inCheckoutEnv(context, witnessed(context, `dotnet test ${TEST_OPTIONS}`)),
        quick: (context) => {
            const command = guardTests(context);
            return command === null ? null : inCheckoutEnv(context, witnessed(context, command));
        },
        limitSeconds: 600,
    },
];
