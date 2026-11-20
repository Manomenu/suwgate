import type { Step, StepContext } from "../gate/contract.ts";
import { DATABASE_UP } from "./database.ts";
import { changedIn, quoted, read, tracked, withChanged } from "./shell.ts";

const DOTNET_INPUT =
    /\.(cs|csproj|props|targets|slnx|sln|rsp)$|(^|\/)(\.editorconfig|BannedSymbols\.txt|global\.json|packages\.lock\.json|nuget\.config)$/;

const GUARD_PACKAGE = /Suwgate\.(Architecture|Database)\b/;

const BUILD = "dotnet build --nologo -v quiet";

const TEST = "dotnet test --no-build --no-progress";

export const DOTNET_BUILD = "dotnet-build";

export const DOTNET_TEST = "dotnet-test";

function dotnetChanged(context: StepContext): boolean {
    return changedIn(context, DOTNET_INPUT).length > 0;
}

export function guardTests(context: StepContext): string | null {
    if (!dotnetChanged(context)) return null;
    const projects = tracked(context, ["*.csproj"]).filter((project) => GUARD_PACKAGE.test(read(context, project) ?? ""));
    if (projects.length === 0) return null;
    return projects.map((project) => `dotnet test --project ${quoted(project)} --no-build --no-progress`).join(" && ");
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
        run: "dotnet tool restore >/dev/null && dotnet csharpier check .",
        quick: (context) => {
            const command = withChanged(context, /\.cs$/, "dotnet csharpier check");
            return command === null ? null : `dotnet tool restore >/dev/null && ${command}`;
        },
        limitSeconds: 120,
    },
    {
        id: DOTNET_TEST,
        title: "tests (dotnet test, xUnit v3; --quick: the projects that test with Suwgate.Architecture or Suwgate.Database)",
        profile: "dotnet",
        needs: ["dotnet"],
        after: [DOTNET_BUILD, DATABASE_UP],
        run: TEST,
        quick: guardTests,
        limitSeconds: 600,
    },
];
