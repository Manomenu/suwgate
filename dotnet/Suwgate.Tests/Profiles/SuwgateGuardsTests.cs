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

    [Fact]
    public void Without_an_evidence_directory_nothing_is_written()
    {
        var evidence = new Evidence(null);

        evidence.Record("architecture/layers", passed: true);

        Assert.Empty(wired.Recorded());
    }
}
