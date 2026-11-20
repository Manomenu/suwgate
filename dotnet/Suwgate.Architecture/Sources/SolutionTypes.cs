using System.Reflection;
using System.Runtime.CompilerServices;

namespace Suwgate.Architecture.Sources;

public static class SolutionTypes
{
    public static IReadOnlyList<Type> Of(params Assembly[] assemblies) =>
        [
            .. assemblies
                .SelectMany(assembly => assembly.DefinedTypes)
                .Select(info => info.AsType())
                .Where(type => type.GetCustomAttribute<CompilerGeneratedAttribute>() is null)
                .Where(type => !(type.FullName ?? type.Name).Contains('<', StringComparison.Ordinal)),
        ];

    internal static string SimpleName(Type type) => type.Name.Split('`')[0];

    internal static string NameOf(Type type) => type.FullName ?? type.Name;
}
