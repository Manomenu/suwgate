using System.Reflection;
using System.Text.RegularExpressions;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Code;

public sealed partial class ForbiddenTypeNames(IReadOnlyCollection<Type> types) : IGuard
{
    public const string GuardId = "architecture/forbidden-type-names";

    private const string Fix =
        "name it after the feature or after what it is (Database, Output), not after who uses it or what kind of code it is; one feature is one folder";

    public static readonly IReadOnlyList<string> Vague =
    [
        "Common",
        "Helper",
        "Helpers",
        "Manager",
        "Misc",
        "Shared",
        "Stuff",
        "Util",
        "Utilities",
        "Utility",
        "Utils",
    ];

    public static readonly IReadOnlyList<string> LayerByKind =
    [
        "Application",
        "Components",
        "Controllers",
        "Core",
        "Domain",
        "Hooks",
        "DTOs",
        "Infrastructure",
        "Interfaces",
        "Lib",
        "Models",
        "Repositories",
        "Services",
        "Ui",
    ];

    public static readonly IReadOnlyList<string> Suffixes = ["Repository", "Service", "UnitOfWork"];

    private static readonly IReadOnlyList<string> Segments = [.. Vague, .. LayerByKind, "Base"];

    public string Id => GuardId;

    public static ForbiddenTypeNames Of(params Assembly[] assemblies) => new(SolutionTypes.Of(assemblies));

    [GeneratedRegex("[A-Z][a-z0-9]*")]
    private static partial Regex Word();

    public static string? ForbiddenIn(string name, IReadOnlyList<string> forbidden) =>
        forbidden.FirstOrDefault(entry =>
            string.Equals(entry, name, StringComparison.OrdinalIgnoreCase) || Word().Matches(name).Any(word => word.Value == entry)
        );

    public IEnumerable<Finding> Check()
    {
        var namespaces = types
            .Select(type => type.Namespace ?? "")
            .Distinct(StringComparer.Ordinal)
            .SelectMany(name => ForbiddenSegments(name.Split('.')))
            .Distinct()
            .OrderBy(item => item.prefix, StringComparer.Ordinal)
            .Select(item => new Finding(item.prefix, $"the namespace segment {item.segment} is a forbidden word ({item.word}): {Fix}"));
        var names = types
            .Select(type =>
                (type, word: ForbiddenIn(SolutionTypes.SimpleName(type), Vague) ?? ForbiddenSuffix(SolutionTypes.SimpleName(type)))
            )
            .Where(item => item.word is not null)
            .OrderBy(item => SolutionTypes.NameOf(item.type), StringComparer.Ordinal)
            .Select(item => new Finding(SolutionTypes.NameOf(item.type), $"the type name holds a forbidden word ({item.word}): {Fix}"));
        return [.. namespaces, .. names];
    }

    private static IEnumerable<(string prefix, string segment, string word)> ForbiddenSegments(string[] segments) =>
        segments
            .Select((segment, index) => (prefix: string.Join('.', segments[..(index + 1)]), segment, word: ForbiddenIn(segment, Segments)))
            .Where(item => item.word is not null)
            .Select(item => (item.prefix, item.segment, item.word ?? ""));

    private static string? ForbiddenSuffix(string name) =>
        Suffixes.FirstOrDefault(suffix => name.EndsWith(suffix, StringComparison.Ordinal));
}
