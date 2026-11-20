import { describe, expect, it } from "vitest";

import { contextOf } from "./testContext.ts";
import { unusedNugetVersions } from "./unusedNugetVersions.ts";

const CENTRAL = `<Project>
  <ItemGroup>
    <PackageVersion Include="Dapper" Version="2.1.89" />
    <PackageVersion Include="xunit.v3" Version="4.0.2" />
    <PackageVersion Include="Polly" Version="8.0.0" />
    <GlobalPackageReference Include="Suwgate.Architecture" Version="0.1.0" />
  </ItemGroup>
</Project>`;

describe("unused-nuget-versions", () => {
    it("passes when every version is referenced by a project or the props", async () => {
        expect(
            await unusedNugetVersions.check(
                contextOf({
                    "Directory.Packages.props": CENTRAL,
                    "Directory.Build.props": '<Project><ItemGroup><PackageReference Include="Polly" /></ItemGroup></Project>',
                    "App/App.csproj": '<Project><ItemGroup><PackageReference Include="Dapper" /></ItemGroup></Project>',
                    "App.Tests/App.Tests.csproj": '<Project><ItemGroup><PackageReference Include="xunit.v3" /></ItemGroup></Project>',
                }),
            ),
        ).toEqual([]);
    });

    it("finds a version no project references, with the fix", async () => {
        expect(
            await unusedNugetVersions.check(
                contextOf({
                    "Directory.Packages.props": CENTRAL,
                    "App/App.csproj": '<Project><ItemGroup><PackageReference Include="Dapper" /></ItemGroup></Project>',
                }),
            ),
        ).toEqual([
            {
                target: "Polly",
                message:
                    "no project references it: remove its PackageVersion from Directory.Packages.props; a package arrives with the first code that uses it",
            },
            {
                target: "xunit.v3",
                message:
                    "no project references it: remove its PackageVersion from Directory.Packages.props; a package arrives with the first code that uses it",
            },
        ]);
    });

    it("has nothing to check without central package management", async () => {
        expect(await unusedNugetVersions.check(contextOf({ "App/App.csproj": "<Project />" }))).toEqual([]);
    });
});
