namespace Suwgate.Architecture.Sources;

public sealed record ProjectRules(IReadOnlyList<string> Layers, IReadOnlyList<string> References, IReadOnlyList<string> InternalsVisibleTo)
{
    public IReadOnlyDictionary<string, IReadOnlyList<string>> Areas { get; init; } = new Dictionary<string, IReadOnlyList<string>>();

    public bool SubFeatures { get; init; }
}
