namespace Suwgate.Architecture.Sources;

public sealed record ProjectRules(IReadOnlyList<string> Layers, IReadOnlyList<string> References, IReadOnlyList<string> InternalsVisibleTo);
