using Suwgate.Architecture.Profiles;
using Suwgate.Database.Profiles;

namespace Suwgate.Tests.Profiles;

public sealed class DatabaseProfileTests
{
    private static ProfileContext Context(WiredRepository wired, string? directory = null) =>
        new(
            wired.Repository,
            WiredRepository.Settings(
                ["dotnet", "database"],
                settings: directory is null
                    ? null
                    : new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal)
                    {
                        ["database/migration-script-names"] = new Dictionary<string, string>(StringComparer.Ordinal)
                        {
                            ["directory"] = directory,
                        },
                    }
            ),
            new GuardInputs { Production = [] }
        );

    [Fact]
    public void The_one_migrations_up_folder_is_found()
    {
        using var wired = new WiredRepository();

        Assert.Equal("Wired/Database/Migrations/up", DatabaseProfile.MigrationsDirectory(Context(wired)));
    }

    [Fact]
    public void The_setting_in_suwgate_yml_wins()
    {
        using var wired = new WiredRepository();

        Assert.Equal("sql/schema", DatabaseProfile.MigrationsDirectory(Context(wired, "sql/schema")));
    }

    [Fact]
    public void Two_candidate_folders_fail_with_the_setting_to_add()
    {
        using var wired = new WiredRepository(
            new Dictionary<string, string>(StringComparer.Ordinal) { ["Other/Migrations/up/0001_x.sql"] = "select 1;" }
        );

        var failure = Assert.Throws<InvalidOperationException>(() => DatabaseProfile.MigrationsDirectory(Context(wired)));

        Assert.Contains("settings: database/migration-script-names: directory: <folder>", failure.Message, StringComparison.Ordinal);
    }
}
