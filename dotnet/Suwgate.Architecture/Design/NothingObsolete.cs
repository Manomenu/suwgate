using System.Reflection;
using System.Runtime.CompilerServices;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class NothingObsolete(params Assembly[] assemblies) : IGuard
{
    public const string GuardId = "architecture/nothing-obsolete";

    private const BindingFlags AllMembers =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

    public string Id => GuardId;

    public IEnumerable<Finding> Check() =>
        SolutionTypes
            .Of(assemblies)
            .SelectMany(type => new MemberInfo[] { type }.Concat(type.GetMembers(AllMembers)))
            .Where(member => member.GetCustomAttribute<ObsoleteAttribute>() is not null)
            .Where(member => member.GetCustomAttribute<CompilerFeatureRequiredAttribute>() is null)
            .Select(member => member is Type type ? SolutionTypes.NameOf(type) : $"{member.DeclaringType?.FullName}.{member.Name}")
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .Select(name => new Finding(name, "it is marked [Obsolete]: migrate the callers and delete it in this change, no shims"));
}
