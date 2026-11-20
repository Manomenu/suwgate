using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Tests.Architecture;

public sealed class ExceptionFieldsTests
{
    private const string OnceException = """
        profiles: [dotnet]
        exceptions:
          - guard: architecture/fixed
            target: App.IStore
            reason: the owner approved it once
            once: true
        """;

    private sealed class FixedGuard(params Finding[] findings) : IGuard
    {
        public string Id => "architecture/fixed";

        public IEnumerable<Finding> Check() => findings;
    }

    [Fact]
    public void A_message_narrows_the_exception_so_a_second_finding_of_the_target_still_fails()
    {
        var guard = new FixedGuard(new Finding("App.IStore", "one implementation"), new Finding("App.IStore", "never used"));
        var exceptions = new[] { new ExceptionEntry("architecture/fixed", "App.IStore", "an SDK asks for it", Message: "implementation") };

        var failure = Assert.Throws<GuardFailedException>(() => Guards.Verify(guard, exceptions));

        Assert.Contains("architecture/fixed: App.IStore: never used", failure.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("one implementation", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void An_exception_whose_message_matches_no_finding_fails_naming_the_message()
    {
        var guard = new FixedGuard(new Finding("App.IStore", "one implementation"));
        var exceptions = new[]
        {
            new ExceptionEntry("architecture/fixed", "App.IStore", "a reason"),
            new ExceptionEntry("architecture/fixed", "App.IStore", "a reason", Message: "never used"),
        };

        var failure = Assert.Throws<GuardFailedException>(() => Guards.Verify(guard, exceptions));

        Assert.Contains(
            "App.IStore: the exception in suwgate.yml (message: never used) matches nothing any more: delete it",
            failure.Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void The_message_and_once_are_read_from_suwgate_yml()
    {
        using var repository = new TemporaryRepository(
            new Dictionary<string, string>
            {
                ["suwgate.yml"] =
                    "profiles: [dotnet]\nexceptions:\n  - guard: architecture/fixed\n    target: App.IStore\n    reason: a reason\n    message: one implementation\n    once: true\n",
            }
        );

        var settings = SuwgateFile.Read(Path.Combine(repository.Files.Root, "suwgate.yml"), _ => null);

        Assert.Equal(
            [new ExceptionEntry("architecture/fixed", "App.IStore", "a reason", "one implementation", Once: true)],
            settings.Exceptions
        );
    }

    [Fact]
    public void A_one_time_exception_excepts_nothing_once_master_has_it_and_is_never_stale()
    {
        using var repository = new TemporaryRepository(new Dictionary<string, string> { ["suwgate.yml"] = OnceException });
        var path = Path.Combine(repository.Files.Root, "suwgate.yml");

        Assert.Single(SuwgateFile.Read(path, _ => "profiles: [dotnet]\n").Exceptions);
        var merged = SuwgateFile.Read(path, _ => OnceException).Exceptions;

        Assert.Empty(merged);
        Guards.Verify(new FixedGuard(), merged);
        Assert.Throws<GuardFailedException>(() => Guards.Verify(new FixedGuard(new Finding("App.IStore", "edited again")), merged));
    }

    [Fact]
    public void Master_is_read_from_git_on_the_branch_and_after_the_merge()
    {
        using var repository = new TemporaryRepository(new Dictionary<string, string> { ["suwgate.yml"] = "profiles: [dotnet]\n" });
        var root = repository.Files.Root;
        var path = Path.Combine(root, "suwgate.yml");
        RunGit(root, "init", "-q", "-b", "master");
        RunGit(root, "add", "suwgate.yml");
        RunGit(root, "commit", "-q", "-m", "master");
        RunGit(root, "switch", "-q", "-c", "feature/edit");
        File.WriteAllText(path, OnceException);

        Assert.Single(SuwgateFile.Read(path).Exceptions);

        RunGit(root, "commit", "-q", "-am", "add the one-time exception");
        RunGit(root, "switch", "-q", "master");
        RunGit(root, "merge", "-q", "--ff-only", "feature/edit");

        Assert.Empty(SuwgateFile.Read(path).Exceptions);
    }

    [Fact]
    public void Git_runs_on_the_repository_of_its_directory_even_inside_a_git_hook_that_names_another()
    {
        var environment = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["GIT_DIR"] = "/elsewhere/.git/worktrees/branch",
            ["GIT_INDEX_FILE"] = "/elsewhere/.git/index",
            ["GIT_WORK_TREE"] = "/elsewhere",
            ["PATH"] = "/usr/bin",
        };

        Git.OfTheDirectoryOnly(environment);

        Assert.Equal(["PATH"], environment.Keys);
    }

    private static void RunGit(string root, params string[] arguments)
    {
        var result = Git.Run(
            root,
            ["-c", "user.name=suwgate", "-c", "user.email=suwgate@example.invalid", "-c", "commit.gpgsign=false", .. arguments]
        );
        Assert.True(result.Succeeded, result.Error);
    }
}
