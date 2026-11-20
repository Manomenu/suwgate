using Suwgate.Architecture.Profiles;
using Suwgate.Database.Migrations;

namespace Suwgate.Database.Profiles;

public sealed class DatabaseProfile : IGuardProfile
{
    public const string DirectorySetting = "directory";

    public string Name => SuwgateGuards.DatabaseProfile;

    public IReadOnlyList<PlannedGuard> Guards(ProfileContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return
        [
            new(
                MigrationScriptNames.GuardId,
                () => new MigrationScriptNames(Path.Combine(context.Repository.Root, MigrationsDirectory(context)))
            ),
        ];
    }

    public static string MigrationsDirectory(ProfileContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var set = context.Settings.Setting(MigrationScriptNames.GuardId, DirectorySetting);
        if (set is not null)
        {
            return set;
        }
        var folders = context
            .Repository.Paths.Where(path => !path.Contains("node_modules/", StringComparison.Ordinal))
            .Select(path => Path.GetDirectoryName(path)?.Replace('\\', '/') ?? "")
            .Where(folder => folder == "Migrations/up" || folder.EndsWith("/Migrations/up", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();
        return folders.Count == 1
            ? folders[0]
            : throw new InvalidOperationException(
                (
                    folders.Count == 0
                        ? "no folder Migrations/up holds a tracked file"
                        : $"{folders.Count} folders could hold the migrations ({string.Join(", ", folders)})"
                )
                    + $": name the folder of the NNNN_what_it_does.sql scripts in suwgate.yml (settings: {MigrationScriptNames.GuardId}: {DirectorySetting}: <folder>), or skip the guard (guards.skip) with a reason"
            );
    }
}
