using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class Endpoints(Assembly assembly, string mappingNamespace, string suffix) : IGuard
{
    public const string GuardId = "architecture/endpoints";

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        var endpoints = DependencyModel
            .TypesOf([assembly])
            .Where(type => type.Name.EndsWith(suffix, StringComparison.Ordinal) && type.Namespace.FullName != mappingNamespace)
            .ToList();
        var unmapped = endpoints
            .Where(type => !DependencyModel.Users(type).Any(user => user.Namespace.FullName == mappingNamespace))
            .OrderBy(type => type.FullName, StringComparer.Ordinal)
            .Select(type => new Finding(
                type.FullName,
                $"nothing in {mappingNamespace} maps it: call its Map method from there, so that grep finds the wiring of every route in one place"
            ));
        var crowded = endpoints
            .GroupBy(type => type.Namespace.FullName, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new Finding(
                group.Key,
                $"{group.Count()} *{suffix} classes ({string.Join(", ", group.Select(type => type.Name).Order(StringComparer.Ordinal))}): "
                    + "a second set of routes is a second feature, so give it a folder and a layer of its own"
            ));
        return [.. unmapped, .. crowded];
    }
}
