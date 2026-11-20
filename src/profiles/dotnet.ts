import type { Step } from "../gate/contract.ts";
import { changedIn, withChanged } from "./shell.ts";

const DOTNET_INPUT =
    /\.(cs|csproj|props|targets|slnx|sln|rsp)$|(^|\/)(\.editorconfig|BannedSymbols\.txt|global\.json|packages\.lock\.json|nuget\.config)$/;

const whenDotnetChanged = (command: string) => (context: Parameters<typeof changedIn>[0]) =>
    changedIn(context, DOTNET_INPUT).length === 0 ? null : command;

export const dotnetSteps: readonly Step[] = [
    {
        id: "dotnet-build",
        title: "build (compiler, analyzers, banned APIs, NuGet audit)",
        profile: "dotnet",
        needs: ["dotnet"],
        run: "dotnet build --nologo -v quiet",
        quick: whenDotnetChanged("dotnet build --nologo -v quiet"),
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
        id: "dotnet-test",
        title: "tests (dotnet test, xUnit v3)",
        profile: "dotnet",
        needs: ["dotnet"],
        after: ["dotnet-build"],
        run: "dotnet test --no-build --no-progress",
        quick: whenDotnetChanged("dotnet test --no-build --no-progress"),
        limitSeconds: 600,
    },
];
