namespace Suwgate.Architecture.Sources;

internal sealed class LevelList(IEnumerable<string> layers)
{
    private readonly Dictionary<string, int> levels = layers
        .SelectMany((level, index) => LayersFile.Parts(level).Select(part => (part, index)))
        .ToDictionary(item => item.part, item => item.index, StringComparer.Ordinal);

    public int LevelOf(string part) => levels[part];

    public string? PartOf(string relative)
    {
        if (relative.Length == 0)
        {
            return levels.ContainsKey(LayersFile.Root) ? LayersFile.Root : null;
        }
        return levels
            .Keys.Where(part => part != LayersFile.Root && (relative == part || relative.StartsWith(part + ".", StringComparison.Ordinal)))
            .MaxBy(part => part.Length);
    }

    public string Uncovered(string relative)
    {
        var segments = relative.Split('.');
        for (var count = 1; count < segments.Length; count++)
        {
            var prefix = string.Join('.', segments[..count]);
            if (!levels.Keys.Any(part => part.StartsWith(prefix + ".", StringComparison.Ordinal)))
            {
                return prefix;
            }
        }
        return relative;
    }
}
