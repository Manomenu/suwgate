import { describe, expect, it } from "vitest";

import { dependencyDirection } from "./dependencyDirection.ts";
import { findingsOf, shown } from "./testRepository.ts";

const manifest = (content: object) => JSON.stringify(content, null, 4);
const settings = { applications: ["Myapp.*", "@myapp/*"], forbidden: ["@maniumek/suwfrontkit", "Suwbackkit.*"] };

describe("dependency-direction", () => {
    it("passes a library that depends on published libraries only", async () => {
        const files = {
            "package.json": manifest({ dependencies: { yaml: "2.9.1" }, devDependencies: { vitest: "5.1.1" } }),
            "Lib/Lib.csproj": '<PackageReference Include="YamlDotNet" />',
        };
        expect(await findingsOf(dependencyDirection, files, { profiles: ["library"], settings })).toEqual([]);
    });

    it("refuses a library's runtime dependency on an application, in npm and in NuGet", async () => {
        const files = {
            "package.json": manifest({ dependencies: { "@myapp/web": "1.0.0" }, peerDependencies: { "@myapp/api": "1.0.0" } }),
            "Lib/Lib.csproj":
                '<ItemGroup>\n  <PackageReference Include="Myapp.Contracts" />\n  <ProjectReference Include="..\\Myapp.Server\\Myapp.Server.csproj" />\n</ItemGroup>',
        };
        const findings = await findingsOf(dependencyDirection, files, { profiles: ["library"], settings });

        expect(shown(findings)).toEqual(["@myapp/web:3", "@myapp/api:6", "Myapp.Contracts:2", "Myapp.Server:3"]);
        expect(findings[0]?.message).toContain("a library never depends on an application");
    });

    it("lets a library's tests, private apps and development tools use an application", async () => {
        const files = {
            "package.json": manifest({ devDependencies: { "@myapp/web": "1.0.0" } }),
            "consumer/package.json": manifest({ private: true, dependencies: { "@myapp/web": "1.0.0" } }),
            "Lib.Tests/Lib.Tests.csproj": '<ProjectReference Include="../Myapp.Server/Myapp.Server.csproj" />',
            "Sample/Sample.csproj": '<IsPackable>false</IsPackable><PackageReference Include="Myapp.Contracts" />',
        };
        expect(await findingsOf(dependencyDirection, files, { profiles: ["library"], settings })).toEqual([]);
    });

    it("refuses a library's runtime dependency on a local path outside the package, which only an unpublished app can be", async () => {
        const files = {
            "package.json": manifest({ dependencies: { other: "link:../other-app", own: "workspace:*" } }),
            "Lib/Lib.csproj":
                '<ProjectReference Include="../../app/App.Server/App.Server.csproj" /><ProjectReference Include="../Core2/Core2.csproj" />',
        };
        const findings = await findingsOf(dependencyDirection, files, { profiles: ["library"] });

        expect(shown(findings)).toEqual(["other:3", "App.Server:1"]);
        expect(findings[0]?.message).toContain("takes it from link:../other-app");
    });

    it("lets an application depend on whatever it needs", async () => {
        const files = { "package.json": manifest({ dependencies: { "@myapp/api": "1.0.0", local: "link:../x" } }) };
        expect(await findingsOf(dependencyDirection, files, { profiles: ["web"], settings })).toEqual([]);
    });

    it("refuses a forbidden package in any repository and any dependency group, so suwgate never needs the kits it checks", async () => {
        const files = {
            "package.json": manifest({ devDependencies: { "@maniumek/suwfrontkit": "1.0.0" } }),
            "Directory.Packages.props": '<PackageVersion Include="Suwbackkit.Database" Version="1.0.0" />',
            "Tests/Tests.csproj": '<PackageReference Include="Suwbackkit.Testing" />',
        };
        const findings = await findingsOf(dependencyDirection, files, { profiles: ["library", "dotnet"], settings });

        expect(shown(findings)).toEqual(["@maniumek/suwfrontkit:3", "Suwbackkit.Database:1", "Suwbackkit.Testing:1"]);
        expect(findings[0]?.message).toContain("settings.dependency-direction.forbidden");
    });
});
