using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;
using Visibility = ArchUnitNET.Domain.Visibility;

namespace Suwgate.Architecture.Design;

public sealed class NoUnusedTypes(
    IReadOnlyCollection<Assembly> assemblies,
    IReadOnlyCollection<string> entryPoints,
    IReadOnlyCollection<string> rootNamespaces,
    IReadOnlyCollection<SourceFile> sources
) : IGuard
{
    public const string GuardId = "architecture/no-unused-types";

    private const BindingFlags Constants = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly;

    public NoUnusedTypes(IReadOnlyCollection<Assembly> assemblies, IReadOnlyCollection<string> entryPoints)
        : this(assemblies, entryPoints, [.. assemblies.Select(assembly => assembly.GetName().Name ?? "")], []) { }

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        var generated = new Lazy<IReadOnlyList<(string Owner, string Used)>>(() => GeneratedCodeUses.Of(assemblies));
        var names = new Lazy<SourceNames>(() => new SourceNames(sources));
        var types = SolutionTypes.Of([.. assemblies]).ToDictionary(SolutionTypes.NameOf, StringComparer.Ordinal);
        return
        [
            .. DependencyModel
                .TypesOf(assemblies, [.. rootNamespaces, .. assemblies.Select(assembly => assembly.GetName().Name ?? "")])
                .Where(type => type.Visibility != Visibility.Public && !entryPoints.Contains(type.FullName))
                .Where(type => !DependencyModel.Users(type).Any())
                .Select(type => type.FullName)
                .Distinct(StringComparer.Ordinal)
                .Where(name => !generated.Value.Any(use => use.Used == name && !IsSelf(use.Owner, name)))
                .Where(name => !types.TryGetValue(name, out var type) || !NamedInSources(type, names.Value))
                .Order(StringComparer.Ordinal)
                .Select(name => new Finding(
                    name,
                    "no other type uses this non-public type: delete it, or pass it as an entry point if the runtime starts it"
                )),
        ];
    }

    private static bool NamedInSources(Type type, SourceNames names)
    {
        var name = SolutionTypes.SimpleName(type);
        var constants = type.GetFields(Constants).Where(field => field.IsLiteral).Select(field => field.Name).ToList();
        return names.NamedInAttribute(name) || (constants.Count > 0 && names.NamesMember(name, constants));
    }

    private static bool IsSelf(string owner, string name) => owner == name || owner.StartsWith(name + "+", StringComparison.Ordinal);
}
