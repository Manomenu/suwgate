using System.Reflection;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class EveryProjectGuarded(LayersFile layers, params Assembly[] assemblies) : IGuard
{
    public const string GuardId = "architecture/every-project-guarded";

    private static readonly string[] GuardPackages = ["Suwgate.Architecture", "Suwgate.Database"];

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        ArgumentNullException.ThrowIfNull(layers);
        var read = assemblies.Select(assembly => assembly.GetName().Name).ToHashSet(StringComparer.Ordinal);
        var production = layers
            .Projects.Where(project =>
                !project.Key.EndsWith(".Tests", StringComparison.Ordinal) && !IsGate(layers.AssemblyNameOf(project.Key))
            )
            .OrderBy(project => project.Key, StringComparer.Ordinal)
            .ToList();
        var unread = production
            .Where(project => !read.Contains(layers.AssemblyNameOf(project.Key)))
            .Select(project => new Finding(
                project.Key,
                $"the guards over types never read it: add typeof(<a type of {project.Key}>).Assembly to the assemblies the gate passes them"
            ));
        var unlayered = production
            .Where(project => project.Value.Layers.Count == 0)
            .Select(project => new Finding(
                project.Key,
                $"it has no layers: give it \"layers\" in {layers.Path}, top to bottom, so that the layers guard checks it"
            ));
        return [.. unread, .. unlayered];
    }

    private static bool IsGate(string assemblyName)
    {
        try
        {
            return Assembly
                .Load(new AssemblyName(assemblyName))
                .GetReferencedAssemblies()
                .Any(reference => GuardPackages.Contains(reference.Name, StringComparer.Ordinal));
        }
        catch (FileNotFoundException)
        {
            return false;
        }
    }
}
