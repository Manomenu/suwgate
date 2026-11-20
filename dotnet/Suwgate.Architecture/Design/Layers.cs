using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class Layers(LayersFile file, params Assembly[] assemblies) : IGuard
{
    public const string GuardId = "architecture/layers";

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        ArgumentNullException.ThrowIfNull(file);
        var types = DependencyModel.TypesOf(assemblies);
        return
        [
            .. assemblies
                .Select(assembly => assembly.GetName().Name ?? "")
                .Where(root => file.LevelsOf(root).Count > 0)
                .SelectMany(root => FindingsOf(root, [.. types.Where(type => DependencyModel.RootOf(type, root) is not null)])),
        ];
    }

    private IEnumerable<Finding> FindingsOf(string root, IReadOnlyList<ArchUnitNET.Domain.IType> types)
    {
        var levels = file.LevelsOf(root);
        var levelOf = levels
            .SelectMany((parts, level) => parts.Select(part => (part, level)))
            .ToDictionary(item => item.part, item => item.level, StringComparer.Ordinal);
        var unlayered = types
            .Select(type => DependencyModel.PartOf(type, root))
            .OfType<string>()
            .Where(part => !levelOf.ContainsKey(part))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .Select(part => new Finding(
                $"{root}.{part}",
                $"the namespace has no layer: add {part} to the layers of {root} in {file.Path}, at the level it belongs (\"A | B\" puts two on one level)"
            ));
        var crossing =
            from type in types
            let part = DependencyModel.PartOf(type, root)
            where part is not null && levelOf.ContainsKey(part)
            from used in type.Dependencies.Select(link => link.Target).Distinct()
            let usedPart = DependencyModel.PartOf(used, root)
            where usedPart is not null && usedPart != part && levelOf.TryGetValue(usedPart, out var level) && level <= levelOf[part]
            group used.FullName by (origin: type.FullName, part, usedPart) into edge
            orderby edge.Key.origin, edge.Key.usedPart
            select new Finding(
                edge.Key.origin,
                $"{edge.Key.part} uses {string.Join(", ", edge.Distinct().Order(StringComparer.Ordinal))} of {edge.Key.usedPart}, which is above it or beside it: "
                    + $"move the shared code down to a lower layer, or pass it in from above (the layers of {root} in {file.Path})"
            );
        return unlayered.Concat(crossing);
    }
}
