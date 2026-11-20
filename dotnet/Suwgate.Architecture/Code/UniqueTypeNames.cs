using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Code;

public sealed class UniqueTypeNames(IReadOnlyCollection<Type> types) : IGuard
{
    public const string GuardId = "architecture/unique-type-names";

    public string Id => GuardId;

    public static UniqueTypeNames Of(params Assembly[] assemblies) => new(SolutionTypes.Of(assemblies));

    public IEnumerable<Finding> Check() =>
        types
            .GroupBy(SolutionTypes.SimpleName, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new Finding(
                group.Key,
                $"{group.Count()} types share the name ({string.Join(", ", group.Select(SolutionTypes.NameOf).Order(StringComparer.Ordinal))}): "
                    + "rename all but one, so that grep for the name finds exactly one definition"
            ));
}
