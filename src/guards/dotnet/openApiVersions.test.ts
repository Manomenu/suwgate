import { describe, expect, it } from "vitest";

import { centralVersion, openApiVersions } from "./openApiVersions.ts";
import { contextOf } from "./testContext.ts";

const props = (...lines: string[]) => `<Project><ItemGroup>${lines.join("")}</ItemGroup></Project>`;
const tool = (version: string) => `<PackageVersion Include="Microsoft.Extensions.ApiDescription.Server" Version="${version}" />`;
const library = (version: string) => `<PackageVersion Version="${version}" Include="Microsoft.AspNetCore.OpenApi" />`;

describe("openapi-versions", () => {
    it("passes the tool and the library at the same version, and a repository without the tool", async () => {
        expect(await openApiVersions.check(contextOf({ "Directory.Packages.props": props(tool("10.0.15"), library("10.0.15")) }))).toEqual(
            [],
        );
        expect(await openApiVersions.check(contextOf({ "Directory.Packages.props": props(library("10.0.15")) }))).toEqual([]);
    });

    it("asks to pin the library beside the tool when only a package brings it in", async () => {
        const [finding] = await openApiVersions.check(contextOf({ "Directory.Packages.props": props(tool("10.0.15")) }));
        expect(finding?.message).toContain('<PackageVersion Include="Microsoft.AspNetCore.OpenApi" Version="10.0.15" />');
    });

    it("finds the two at different versions", async () => {
        const [finding] = await openApiVersions.check(
            contextOf({ "Directory.Packages.props": props(tool("10.0.15"), library("10.0.12")) }),
        );
        expect(finding?.message).toContain("is 10.0.15 but Microsoft.AspNetCore.OpenApi is 10.0.12");
    });

    it("reads a version whatever the order of the attributes", () => {
        expect(centralVersion(props(library("1.2.3")), "Microsoft.AspNetCore.OpenApi")).toBe("1.2.3");
        expect(centralVersion(props(tool("4.5.6")), "Microsoft.Extensions.ApiDescription.Server")).toBe("4.5.6");
    });
});
