using System.Reflection;
using ArchUnitNET.Loader;
using IType = ArchUnitNET.Domain.IType;

namespace Suwgate.Architecture.Sources;

internal static class DependencyModel
{
    public static IReadOnlyList<IType> TypesOf(IReadOnlyCollection<Assembly> assemblies)
    {
        var model = new ArchLoader().LoadAssemblies([.. assemblies]).Build();
        var roots = assemblies.Select(assembly => assembly.GetName().Name ?? "").ToList();
        return
        [
            .. model.Types.Where(type =>
                !type.Name.Contains('<', StringComparison.Ordinal) && roots.Exists(root => RootOf(type, root) is not null)
            ),
        ];
    }

    public static string? RootOf(IType type, string root)
    {
        var name = type.Namespace.FullName;
        return name == root || name.StartsWith(root + ".", StringComparison.Ordinal) ? root : null;
    }

    public static string? PartOf(IType type, string root)
    {
        var name = type.Namespace.FullName;
        return name.StartsWith(root + ".", StringComparison.Ordinal) ? name[(root.Length + 1)..].Split('.')[0] : null;
    }

    public static IEnumerable<IType> Users(IType type) =>
        type
            .BackwardsDependencies.Select(link => link.Origin)
            .Where(user => user != type && !user.FullName.StartsWith(type.FullName + "+", StringComparison.Ordinal));
}
