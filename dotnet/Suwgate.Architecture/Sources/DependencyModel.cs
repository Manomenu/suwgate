using System.Reflection;
using ArchUnitNET.Loader;
using IType = ArchUnitNET.Domain.IType;

namespace Suwgate.Architecture.Sources;

internal static class DependencyModel
{
    public static IReadOnlyList<IType> TypesOf(IReadOnlyCollection<Assembly> assemblies) =>
        TypesOf(assemblies, [.. assemblies.Select(assembly => assembly.GetName().Name ?? "")]);

    public static IReadOnlyList<IType> TypesOf(IReadOnlyCollection<Assembly> assemblies, IReadOnlyCollection<string> roots)
    {
        var model = new ArchLoader().LoadAssemblies([.. assemblies]).Build();
        return
        [
            .. model.Types.Where(type =>
                !type.Name.Contains('<', StringComparison.Ordinal) && roots.Any(root => RelativeNamespace(type, root) is not null)
            ),
        ];
    }

    public static bool In(IType type, Assembly assembly) => type.Assembly.FullName == assembly.FullName;

    public static string? RelativeNamespace(IType type, string root)
    {
        var name = type.Namespace.FullName;
        if (name == root)
        {
            return "";
        }
        return name.StartsWith(root + ".", StringComparison.Ordinal) ? name[(root.Length + 1)..] : null;
    }

    public static IEnumerable<IType> Users(IType type) =>
        type
            .BackwardsDependencies.Select(link => link.Origin)
            .Where(user => user != type && !user.FullName.StartsWith(type.FullName + "+", StringComparison.Ordinal));
}
