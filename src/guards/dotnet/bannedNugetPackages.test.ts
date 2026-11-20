import { describe, expect, it } from "vitest";

import { bannedNugetPackages } from "./bannedNugetPackages.ts";
import { contextOf } from "./testContext.ts";

async function targets(files: Record<string, string>, settings?: unknown): Promise<string[]> {
    return (await bannedNugetPackages.check(contextOf(files, { settings }))).map((finding) => finding.target);
}

describe("banned-nuget-packages", () => {
    it("passes the packages a .NET app needs", async () => {
        expect(
            await targets({
                "Directory.Packages.props":
                    '<Project><ItemGroup><PackageVersion Include="Dapper" Version="2.1.89" /></ItemGroup></Project>',
                "App/App.csproj":
                    '<Project><ItemGroup><PackageReference Include="Dapper" /><PackageReference Include="MoqLike" /></ItemGroup></Project>',
            }),
        ).toEqual([]);
    });

    it.each([
        ["MediatR", "MediatR"],
        ["moq", "moq"],
        ["Microsoft.EntityFrameworkCore.Design", "Microsoft.EntityFrameworkCore.Design"],
        ["Newtonsoft.Json", "Newtonsoft.Json"],
        ["FluentAssertions", "FluentAssertions"],
    ])("finds %s, a banned package or one of its family, by its name not its letters", async (name, target) => {
        expect(
            await targets({ "App/App.csproj": `<Project><ItemGroup><PackageReference Include="${name}" /></ItemGroup></Project>` }),
        ).toEqual([target]);
    });

    it("reads versions, references and global references in every MSBuild file, and says how to fix each", async () => {
        const findings = await bannedNugetPackages.check(
            contextOf({
                "Directory.Packages.props":
                    '<Project><ItemGroup><PackageVersion Include="AutoMapper" Version="1" /><GlobalPackageReference Include="Scrutor" Version="1" /></ItemGroup></Project>',
                "App/App.csproj": '<Project><ItemGroup><PackageReference Include="AutoMapper" /></ItemGroup></Project>',
                "App/obj/App.csproj.nuget.g.props": '<Project><PackageReference Include="Moq" /></Project>',
            }),
        );

        expect(findings).toEqual([
            {
                target: "AutoMapper",
                message:
                    "banned package (in Directory.Packages.props, App/App.csproj): remove it and write the mapping by hand (a ToNote() method), so that grep finds it",
            },
            {
                target: "Scrutor",
                message:
                    "banned package (in Directory.Packages.props): remove it and register the services explicitly, no assembly scanning",
            },
        ]);
    });

    it("bans more packages from its settings", async () => {
        expect(
            await targets(
                { "App/App.csproj": '<Project><ItemGroup><PackageReference Include="Polly" /></ItemGroup></Project>' },
                { packages: { Polly: "retry with a plain loop" } },
            ),
        ).toEqual(["Polly"]);
    });

    it("looks only in the directory of the dotnet profile", async () => {
        const context = contextOf(
            { "Server/App.csproj": '<PackageReference Include="Moq" />', "tools/Other.csproj": '<PackageReference Include="Moq" />' },
            { directories: { dotnet: "Server" } },
        );

        expect((await bannedNugetPackages.check(context))[0]?.message).toContain("(in Server/App.csproj)");
    });
});
