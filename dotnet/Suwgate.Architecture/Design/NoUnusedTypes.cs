using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;
using Visibility = ArchUnitNET.Domain.Visibility;

namespace Suwgate.Architecture.Design;

public sealed class NoUnusedTypes(IReadOnlyCollection<Assembly> assemblies, IReadOnlyCollection<string> entryPoints) : IGuard
{
    public const string GuardId = "architecture/no-unused-types";

    public string Id => GuardId;

    public IEnumerable<Finding> Check() =>
        [
            .. DependencyModel
                .TypesOf(assemblies)
                .Where(type => type.Visibility != Visibility.Public && !entryPoints.Contains(type.FullName))
                .Where(type => !DependencyModel.Users(type).Any())
                .Select(type => type.FullName)
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .Select(name => new Finding(
                    name,
                    "no other type uses this non-public type: delete it, or pass it as an entry point if the runtime starts it"
                )),
        ];
}
