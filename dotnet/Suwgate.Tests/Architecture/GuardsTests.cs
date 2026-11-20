using Suwgate.Architecture.Verification;

namespace Suwgate.Tests.Architecture;

public sealed class GuardsTests
{
    private sealed class FixedGuard(params Finding[] findings) : IGuard
    {
        public string Id => "architecture/fixed";

        public IEnumerable<Finding> Check() => findings;
    }

    [Fact]
    public void A_finding_without_an_exception_fails_with_the_guard_the_target_and_the_fix()
    {
        var failure = Assert.Throws<GuardFailedException>(() =>
            Guards.Verify(new FixedGuard(new Finding("App.IStore", "one implementation")), [])
        );

        Assert.Contains("architecture/fixed: App.IStore: one implementation", failure.Message, StringComparison.Ordinal);
        Assert.Contains("add an exception with its reason to suwgate.yml", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void An_exception_of_another_guard_does_not_count()
    {
        var exceptions = new[] { new ExceptionEntry("architecture/other", "App.IStore", "a reason") };

        Assert.Throws<GuardFailedException>(() => Guards.Verify(new FixedGuard(new Finding("App.IStore", "x")), exceptions));
    }

    [Fact]
    public void An_exception_that_matches_nothing_fails_so_that_it_gets_deleted()
    {
        var exceptions = new[] { new ExceptionEntry("architecture/fixed", "App.IGone", "it was needed once") };

        var failure = Assert.Throws<GuardFailedException>(() => Guards.Verify(new FixedGuard(), exceptions));

        Assert.Contains(
            "App.IGone: the exception in suwgate.yml matches nothing any more: delete it",
            failure.Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void The_exceptions_are_read_from_the_nearest_suwgate_yml_above()
    {
        var root = Directory.CreateTempSubdirectory("suwgate-file-");
        try
        {
            File.WriteAllText(
                Path.Combine(root.FullName, "suwgate.yml"),
                "profiles: [dotnet]\nexceptions:\n  - guard: architecture/fixed\n    target: App.IStore\n    reason: an SDK asks for it\n"
            );
            var below = Directory.CreateDirectory(Path.Combine(root.FullName, "bin", "Debug"));

            var exceptions = SuwgateFile.Exceptions(SuwgateFile.Find(below.FullName));

            Assert.Equal([new ExceptionEntry("architecture/fixed", "App.IStore", "an SDK asks for it")], exceptions);
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    [Fact]
    public void An_exception_without_a_reason_is_refused()
    {
        var root = Directory.CreateTempSubdirectory("suwgate-file-");
        var file = Path.Combine(root.FullName, "suwgate.yml");
        File.WriteAllText(file, "profiles: [dotnet]\nexceptions:\n  - guard: architecture/fixed\n    target: App.IStore\n");

        var failure = Assert.Throws<InvalidDataException>(() => SuwgateFile.Exceptions(file));

        Assert.Contains("has no reason: say why it exists", failure.Message, StringComparison.Ordinal);
        root.Delete(recursive: true);
    }

    [Fact]
    public void The_skipped_guards_and_the_settings_are_read_with_their_reasons()
    {
        var root = Directory.CreateTempSubdirectory("suwgate-file-");
        var file = Path.Combine(root.FullName, "suwgate.yml");
        File.WriteAllText(
            file,
            "profiles: [dotnet, database]\nguards:\n  skip:\n    - guard: architecture/endpoints\n      reason: a library has no server\n"
                + "settings:\n  database/migration-script-names:\n    directory: sql/up\n  docs-paths:\n    ignore: [a]\n"
                + "  architecture/no-escape-hatches:\n    nullForgivingInTests: true\n"
        );

        var settings = SuwgateFile.Read(file);

        Assert.Equal(["dotnet", "database"], settings.Profiles);
        Assert.Equal([new GuardSkip("architecture/endpoints", "a library has no server")], settings.Skipped);
        Assert.Equal("sql/up", settings.Setting("database/migration-script-names", "directory"));
        Assert.Equal("true", settings.Setting("architecture/no-escape-hatches", "nullForgivingInTests"));
        root.Delete(recursive: true);
    }

    [Fact]
    public void A_skipped_guard_without_a_reason_is_refused()
    {
        var root = Directory.CreateTempSubdirectory("suwgate-file-");
        var file = Path.Combine(root.FullName, "suwgate.yml");
        File.WriteAllText(file, "profiles: [dotnet]\nguards:\n  skip:\n    - guard: architecture/endpoints\n");

        var failure = Assert.Throws<InvalidDataException>(() => SuwgateFile.Read(file));

        Assert.Contains("has no reason: say why it does not apply", failure.Message, StringComparison.Ordinal);
        root.Delete(recursive: true);
    }
}
