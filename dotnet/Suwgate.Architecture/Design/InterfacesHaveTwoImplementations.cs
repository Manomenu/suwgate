using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class InterfacesHaveTwoImplementations(IReadOnlyCollection<Type> types) : IGuard
{
    public const string GuardId = "architecture/interfaces-have-two-implementations";

    public string Id => GuardId;

    public static InterfacesHaveTwoImplementations Of(params Assembly[] assemblies) => new(SolutionTypes.Of(assemblies));

    public IEnumerable<Finding> Check() =>
        types
            .Where(type => type.IsInterface)
            .Select(contract => (contract, implementations: types.Count(type => !type.IsInterface && contract.IsAssignableFrom(type))))
            .Where(item => item.implementations < 2)
            .OrderBy(item => SolutionTypes.NameOf(item.contract), StringComparer.Ordinal)
            .Select(item => new Finding(
                SolutionTypes.NameOf(item.contract),
                $"{item.implementations} implementation(s): delete the interface and use the class, and extract one when the second implementation arrives"
            ));
}
