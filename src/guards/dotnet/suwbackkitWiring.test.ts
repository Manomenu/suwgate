import { describe, expect, it } from "vitest";

import { suwbackkitWiring } from "./suwbackkitWiring.ts";
import { contextOf } from "./testContext.ts";

const SERVER = '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Suwbackkit.Server" /></ItemGroup></Project>';

const WIRED = `public static class ServerApp
{
    public static WebApplication Build(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.AddServerDefaults();
        var app = builder.Build();
        app.MapServerDefaults();
        return app;
    }
}`;

describe("suwbackkit-wiring", () => {
    it("passes a server that calls AddServerDefaults and MapServerDefaults", async () => {
        expect(
            await suwbackkitWiring.check(contextOf({ "App.Server/App.Server.csproj": SERVER, "App.Server/Api/ServerApp.cs": WIRED })),
        ).toEqual([]);
    });

    it("finds a server that references the kit but never wires it, one finding per missing call", async () => {
        const findings = await suwbackkitWiring.check(
            contextOf({
                "App.Server/App.Server.csproj": SERVER,
                "App.Server/Api/ServerApp.cs": WIRED.replace("app.MapServerDefaults();", ""),
            }),
        );

        expect(findings).toEqual([
            {
                target: "App.Server/App.Server.csproj",
                message: expect.stringContaining("never calls MapServerDefaults: call it on the app (app.MapServerDefaults())") as unknown,
            },
        ]);
    });

    it("leaves alone the kit's own library and its test projects, and a server without the kit", async () => {
        expect(
            await suwbackkitWiring.check(
                contextOf({
                    "src/Suwbackkit.Server/Suwbackkit.Server.csproj": '<Project Sdk="Microsoft.NET.Sdk"></Project>',
                    "tests/Suwbackkit.Server.Tests/Suwbackkit.Server.Tests.csproj":
                        '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><ProjectReference Include="../../src/Suwbackkit.Server/Suwbackkit.Server.csproj" /></ItemGroup></Project>',
                    "Other/Other.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
                }),
            ),
        ).toEqual([]);
    });
});
