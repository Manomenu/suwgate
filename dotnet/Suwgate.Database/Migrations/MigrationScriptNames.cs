using System.Text.RegularExpressions;
using Suwgate.Architecture.Verification;

namespace Suwgate.Database.Migrations;

public sealed partial class MigrationScriptNames(string directory) : IGuard
{
    public const string GuardId = "database/migration-script-names";

    public string Id => GuardId;

    [GeneratedRegex(@"^\d{4}_[a-z0-9]+(_[a-z0-9]+)*\.sql$")]
    private static partial Regex ScriptName();

    public IEnumerable<Finding> Check()
    {
        if (!Directory.Exists(directory))
        {
            return
            [
                new Finding(
                    directory,
                    "the migrations folder does not exist: pass the folder that holds the NNNN_what_it_does.sql scripts"
                ),
            ];
        }
        var scripts = Directory
            .EnumerateFiles(directory)
            .Select(path => Path.GetFileName(path))
            .Where(name => name != ".gitkeep")
            .Order(StringComparer.Ordinal)
            .ToList();
        var misnamed = scripts
            .Where(name => !ScriptName().IsMatch(name))
            .Select(name => new Finding(name, "name it NNNN_what_it_does.sql: four digits, then lower snake case"));
        var duplicated = scripts
            .Where(name => ScriptName().IsMatch(name))
            .GroupBy(name => name[..4], StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .SelectMany(group =>
                group
                    .Skip(1)
                    .Select(name => new Finding(name, $"number {group.Key} is taken by {group.First()}: give it the next free number"))
            );
        return [.. misnamed, .. duplicated];
    }
}
