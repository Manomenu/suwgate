using System.Reflection;
using System.Runtime.CompilerServices;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class InterfacesHaveTwoImplementations(IReadOnlyCollection<Type> types) : IGuard
{
    public const string GuardId = "architecture/interfaces-have-two-implementations";

    public string Id => GuardId;

    public static InterfacesHaveTwoImplementations Of(params Assembly[] assemblies) =>
        new([
            .. assemblies
                .SelectMany(assembly => assembly.DefinedTypes)
                .Select(info => info.AsType())
                .Where(type => type.GetCustomAttribute<CompilerGeneratedAttribute>() is null),
        ]);

    public IEnumerable<Finding> Check() =>
        types
            .Where(type => type.IsInterface)
            .Select(contract => (contract, implementations: types.Count(type => !type.IsInterface && contract.IsAssignableFrom(type))))
            .Where(item => item.implementations < 2)
            .OrderBy(item => item.contract.FullName, StringComparer.Ordinal)
            .Select(item => new Finding(
                item.contract.FullName ?? item.contract.Name,
                $"{item.implementations} implementation(s): delete the interface and use the class, and extract one when the second implementation arrives"
            ));
}
