namespace Suwgate.Architecture.Sources;

internal sealed record Placement(string? Part, string? Feature, string? SubFeature, string? Uncovered, string? Area)
{
    public static Placement Free { get; } = new(null, null, null, null, null);

    public bool Placed => Part is not null;

    public static Placement Missing(string uncovered, string? area) => new(null, null, null, uncovered, area);
}
