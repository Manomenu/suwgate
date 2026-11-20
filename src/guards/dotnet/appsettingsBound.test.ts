import { describe, expect, it } from "vitest";

import { appsettingsBound } from "./appsettingsBound.ts";
import { contextOf } from "./testContext.ts";

const OPTIONS = `services.AddOptions<NotesOptions>().BindConfiguration("Notes");
var mail = configuration.GetSection("Mail");`;

describe("appsettings-bound", () => {
    it("passes sections the code binds or reads, and the framework's own", async () => {
        expect(
            await appsettingsBound.check(
                contextOf({
                    "App/appsettings.json": JSON.stringify({
                        Logging: {},
                        AllowedHosts: "*",
                        ConnectionStrings: {},
                        Kestrel: {},
                        Notes: {},
                        Mail: {},
                    }),
                    "App/appsettings.Development.json": JSON.stringify({ Notes: { PageSize: 5 } }),
                    "App/Options.cs": OPTIONS,
                }),
            ),
        ).toEqual([]);
    });

    it("passes a section read through a const string of an options class", async () => {
        expect(
            await appsettingsBound.check(
                contextOf({
                    "App/appsettings.json": JSON.stringify({ Invocation: {}, Judge: {}, Runs: {} }),
                    "App/InvocationOptions.cs":
                        'public sealed class InvocationOptions\n{\n    public const string Section = "Invocation";\n}',
                    "App/JudgeOptions.cs": 'public sealed record JudgeOptions\n{\n    public const string Section = "Judge";\n}',
                    "App/Runs.cs": 'sealed class RunOptions { internal const string Section = "Runs"; }',
                    "App/Setup.cs": [
                        "services.AddOptions<InvocationOptions>().BindConfiguration(InvocationOptions.Section);",
                        "services.AddOptions<JudgeOptions>().Bind(configuration.GetSection(Judges.JudgeOptions.Section));",
                        "services.AddOptions<RunOptions>().Bind(configuration.GetRequiredSection(RunOptions.Section));",
                    ].join("\n"),
                }),
            ),
        ).toEqual([]);
    });

    it("still finds a section whose constant no code binds", async () => {
        const findings = await appsettingsBound.check(
            contextOf({
                "App/appsettings.json": JSON.stringify({ Mail: {} }),
                "App/MailOptions.cs": 'public sealed class MailOptions { public const string Section = "Mail"; }',
            }),
        );

        expect(findings.map((finding) => finding.target)).toEqual(["Mail"]);
    });

    it("finds a section no code reads, in every appsettings file, with the fix", async () => {
        expect(
            await appsettingsBound.check(
                contextOf({
                    "App/appsettings.json": JSON.stringify({ Notes: {}, Payments: {} }),
                    "App/appsettings.Production.json": JSON.stringify({ Payments: { Key: "x" } }),
                    "App/Options.cs": OPTIONS,
                    "App/settings.json": JSON.stringify({ Ignored: {} }),
                }),
            ),
        ).toEqual([
            {
                target: "Payments",
                message:
                    'no code reads it (in App/appsettings.json, App/appsettings.Production.json): remove the setting, or bind it with services.AddOptions<T>().BindConfiguration("Payments")',
            },
        ]);
    });

    it("reports a file that is not JSON instead of throwing", async () => {
        const [finding] = await appsettingsBound.check(contextOf({ "App/appsettings.json": "{ broken" }));

        expect(finding?.target).toBe("App/appsettings.json");
        expect(finding?.message).toMatch(/^not valid JSON \(.+\): fix the file$/);
    });
});
