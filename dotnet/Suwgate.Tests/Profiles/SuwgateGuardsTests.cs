using Suwgate.Architecture.Profiles;
using Suwgate.Architecture.Verification;
using Suwgate.Database.Profiles;

namespace Suwgate.Tests.Profiles;

public sealed class SuwgateGuardsTests : IDisposable
{
    private static readonly string[] DotnetGuards =
    [
        "architecture/build-settings",
        "architecture/endpoints",
        "architecture/every-project-guarded",
        "architecture/forbidden-type-names",
        "architecture/interfaces-have-two-implementations",
        "architecture/layers",
        "architecture/no-escape-hatches",
        "architecture/no-fixture-in-field",
        "architecture/no-unused-types",
        "architecture/nothing-obsolete",
        "architecture/one-type-per-file",
        "architecture/project-references",
        "architecture/unique-type-names",
    ];

    private readonly WiredRepository wired = new();

    private static GuardInputs Inputs => new() { Production = [WiredRepository.Server], Server = WiredRepository.ServerApp };

    public void Dispose() => wired.Dispose();

    private IReadOnlyList<string> RecordedIds() => [.. wired.Recorded().Select(line => line.Split('\t')[0])];

    [Fact]
    public void Every_guard_of_the_dotnet_profile_runs_and_records_its_outcome_as_evidence()
    {
        wired.Verify(WiredRepository.Settings(["dotnet"]), Inputs);

        Assert.Equal(DotnetGuards, RecordedIds());
        Assert.Contains("architecture/layers\tpassed", wired.Recorded());
        Assert.Contains("architecture/build-settings\tfailed", wired.Recorded());
    }

    [Fact]
    public void A_guard_skipped_in_suwgate_yml_neither_runs_nor_counts_as_evidence()
    {
        var failure = wired.Verify(
            WiredRepository.Settings(["dotnet"], [new GuardSkip("architecture/endpoints", "no server")]),
            new GuardInputs { Production = [WiredRepository.Server] }
        );

        Assert.DoesNotContain("architecture/endpoints", RecordedIds());
        Assert.DoesNotContain("architecture/endpoints", failure?.Message ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public void An_input_the_app_did_not_give_fails_its_guard_with_the_fix()
    {
        var failure = wired.Verify(WiredRepository.Settings(["dotnet"]), new GuardInputs { Production = [WiredRepository.Server] });

        Assert.Contains(
            "architecture/endpoints: GuardInputs.Server is not set: set it to the type in the namespace that maps every endpoint",
            failure?.Message ?? "",
            StringComparison.Ordinal
        );
        Assert.Contains("architecture/endpoints\tfailed", wired.Recorded());
    }

    [Fact]
    public void The_database_profile_without_its_guards_fails_with_the_fix()
    {
        var failure = wired.Verify(WiredRepository.Settings(["dotnet", "database"]), Inputs);

        Assert.Contains(
            "database: the repository has the database profile, so its guards must run: pass new DatabaseProfile()",
            failure?.Message ?? "",
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void The_database_guards_run_when_their_profile_is_passed_and_active()
    {
        wired.Verify(WiredRepository.Settings(["dotnet", "database"]), Inputs, new DatabaseProfile());

        Assert.Contains("database/migration-script-names\tpassed", wired.Recorded());
    }

    [Fact]
    public void A_profile_passed_that_suwgate_yml_does_not_have_fails()
    {
        var failure = wired.Verify(WiredRepository.Settings(["dotnet"]), Inputs, new DatabaseProfile());

        Assert.Contains("database: suwgate.yml has no database profile", failure?.Message ?? "", StringComparison.Ordinal);
        Assert.DoesNotContain("database/migration-script-names", RecordedIds());
    }

    [Theory]
    [InlineData("true", "architecture/no-escape-hatches\tpassed")]
    [InlineData("false", "architecture/no-escape-hatches\tfailed")]
    public void The_setting_for_the_null_forgiving_operator_in_tests_reaches_its_guard(string value, string evidence)
    {
        using var repository = new WiredRepository(
            new Dictionary<string, string>
            {
                ["Wired.Tests/NotesTests.cs"] = "class NotesTests { string? Name; int Length => Name!.Length; }",
            }
        );

        repository.Verify(NullForgiving(value), Inputs);

        Assert.Contains(evidence, repository.Recorded());
    }

    [Fact]
    public void A_setting_for_the_null_forgiving_operator_that_is_not_true_or_false_fails_with_the_fix()
    {
        var failure = wired.Verify(NullForgiving("sometimes"), Inputs);

        Assert.Contains(
            "architecture/no-escape-hatches: suwgate.yml: settings.architecture/no-escape-hatches.nullForgivingInTests is \"sometimes\": set it to true or false",
            failure?.Message ?? "",
            StringComparison.Ordinal
        );
    }

    private static SuwgateSettings NullForgiving(string value) =>
        WiredRepository.Settings(
            ["dotnet"],
            settings: new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal)
            {
                ["architecture/no-escape-hatches"] = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["nullForgivingInTests"] = value,
                },
            }
        );

    [Fact]
    public void Without_an_evidence_directory_nothing_is_written()
    {
        var evidence = new Evidence(null);

        evidence.Record("architecture/layers", passed: true);

        Assert.Empty(wired.Recorded());
    }
}
