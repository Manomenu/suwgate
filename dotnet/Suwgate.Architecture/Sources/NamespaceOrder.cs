namespace Suwgate.Architecture.Sources;

internal sealed class NamespaceOrder(ProjectRules rules)
{
    private readonly LevelList layers = new(rules.Layers);

    private readonly Dictionary<string, LevelList> areas = rules.Areas.ToDictionary(
        area => area.Key,
        area => new LevelList(area.Value),
        StringComparer.Ordinal
    );

    public Placement Place(string relative)
    {
        var part = layers.PartOf(relative);
        if (part is null)
        {
            return relative.Length == 0 ? Placement.Free : Placement.Missing(layers.Uncovered(relative), area: null);
        }
        var rest = part == LayersFile.Root || relative == part ? "" : relative[(part.Length + 1)..];
        if (!areas.TryGetValue(part, out var area))
        {
            return new Placement(part, Feature: null, SubFeature: FirstSegment(rest), Uncovered: null, Area: null);
        }
        var feature = area.PartOf(rest);
        if (feature is null)
        {
            return rest.Length == 0 ? new Placement(part, null, null, null, null) : Placement.Missing(area.Uncovered(rest), part);
        }
        var below = feature == LayersFile.Root || rest == feature ? "" : rest[(feature.Length + 1)..];
        return new Placement(part, feature, FirstSegment(below), Uncovered: null, Area: null);
    }

    public bool SubFeatures => rules.SubFeatures;

    public int LevelOf(string part) => layers.LevelOf(part);

    public int LevelOf(string area, string feature) => areas[area].LevelOf(feature);

    private static string? FirstSegment(string rest) => rest.Length == 0 ? null : rest.Split('.')[0];
}
