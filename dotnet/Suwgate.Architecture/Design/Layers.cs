using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;
using IType = ArchUnitNET.Domain.IType;

namespace Suwgate.Architecture.Design;

public sealed class Layers(LayersFile file, params Assembly[] assemblies) : IGuard
{
    public const string GuardId = "architecture/layers";

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        ArgumentNullException.ThrowIfNull(file);
        var layered = file
            .Projects.Where(project => project.Value.Layers.Count > 0)
            .Select(project =>
                (
                    name: project.Key,
                    rules: project.Value,
                    root: file.RootNamespaceOf(project.Key),
                    assembly: assemblies.FirstOrDefault(assembly => assembly.GetName().Name == file.AssemblyNameOf(project.Key))
                )
            )
            .Where(project => project.assembly is not null)
            .OrderBy(project => project.name, StringComparer.Ordinal)
            .ToList();
        if (layered.Count == 0)
        {
            return [];
        }
        var types = DependencyModel.TypesOf(assemblies, [.. layered.Select(project => project.root)]);
        return
        [
            .. layered.SelectMany(project =>
                new ProjectLayers(project.name, project.root, new NamespaceOrder(project.rules), file.Path).Findings([
                    .. types.Where(type =>
                        project.assembly is not null
                        && DependencyModel.In(type, project.assembly)
                        && DependencyModel.RelativeNamespace(type, project.root) is not null
                    ),
                ])
            ),
        ];
    }

    private sealed class ProjectLayers(string project, string root, NamespaceOrder order, string path)
    {
        public IEnumerable<Finding> Findings(IReadOnlyList<IType> types)
        {
            var placements = types.ToDictionary(type => type, type => order.Place(Relative(type)));
            var missing = placements
                .Values.Where(placement => placement.Uncovered is not null)
                .Select(placement => (placement.Area, Uncovered: placement.Uncovered ?? ""))
                .Distinct()
                .OrderBy(item => item.Area is null ? item.Uncovered : $"{item.Area}.{item.Uncovered}", StringComparer.Ordinal)
                .Select(Missing);
            var crossing =
                from type in types
                let placement = placements[type]
                where placement.Placed
                from used in type.Dependencies.Select(link => link.Target).Distinct()
                where placements.ContainsKey(used)
                let rule = Crossing(placement, placements[used])
                where rule is not null
                group used.FullName by (origin: type.FullName, rule.Value.user, rule.Value.usedPart, rule.Value.fix) into edge
                orderby edge.Key.origin, edge.Key.usedPart
                select new Finding(
                    edge.Key.origin,
                    $"{edge.Key.user} uses {string.Join(", ", edge.Distinct().Order(StringComparer.Ordinal))} of {edge.Key.usedPart}, {edge.Key.fix}"
                );
            return [.. missing, .. crossing];
        }

        private string Relative(IType type) => DependencyModel.RelativeNamespace(type, root) ?? "";

        private Finding Missing((string? Area, string Uncovered) item) =>
            item.Area is null
                ? new Finding(
                    Name(item.Uncovered),
                    $"the namespace has no layer: add {item.Uncovered} to the layers of {project} in {path}, at the level it belongs (\"A | B\" puts two on one level)"
                )
                : new Finding(
                    Name($"{item.Area}.{item.Uncovered}"),
                    $"the namespace has no layer in its area: add {item.Uncovered} to the area {item.Area} of {project} in {path} (\"areas\"), at the level it belongs"
                );

        private (string user, string usedPart, string fix)? Crossing(Placement user, Placement used)
        {
            if (user.Part is null || used.Part is null)
            {
                return null;
            }
            if (user.Part != used.Part)
            {
                return order.LevelOf(used.Part) <= order.LevelOf(user.Part)
                    ? (
                        Relative(user.Part),
                        Relative(used.Part),
                        "which is above it or beside it: move the shared code down to a lower layer, or pass it in from above "
                            + $"(the layers of {project} in {path})"
                    )
                    : null;
            }
            if (user.Feature is not null && used.Feature is not null && user.Feature != used.Feature)
            {
                return order.LevelOf(used.Part, used.Feature) <= order.LevelOf(user.Part, user.Feature)
                    ? (
                        Feature(user),
                        Feature(used),
                        "which is above it or beside it in their area: move the shared code down to a lower feature of the area, "
                            + $"or pass it in from above (the area {user.Part} of {project} in {path})"
                    )
                    : null;
            }
            if (order.SubFeatures && user.Feature == used.Feature && used.SubFeature is not null && user.SubFeature != used.SubFeature)
            {
                var feature = Feature(used);
                var who = user.SubFeature is null ? feature : $"{feature}.{user.SubFeature}";
                return (
                    who,
                    $"{feature}.{used.SubFeature}",
                    $"a sub-feature of {feature}: a sub-feature is built on its feature, so neither the feature nor its other sub-features use it; "
                        + $"move what they need into {feature}, or make it a feature with a layer of its own (\"subFeatures\" of {project} in {path})"
                );
            }
            return null;
        }

        private static string Feature(Placement placement) =>
            placement.Feature is null or LayersFile.Root ? placement.Part ?? "" : $"{placement.Part}.{placement.Feature}";

        private string Relative(string part) => part == LayersFile.Root ? $"the root namespace {root}" : part;

        private string Name(string relative) => $"{root}.{relative}";
    }
}
