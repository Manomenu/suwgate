using System.Xml.Linq;

namespace Suwgate.Architecture.Sources;

internal sealed class ProjectNames(RepositoryFiles? repository)
{
    private readonly Lazy<Dictionary<string, string>> projects = new(() =>
        (repository?.Paths ?? [])
            .Where(path =>
                path.EndsWith(".csproj", StringComparison.Ordinal)
                && !path.Contains("/obj/", StringComparison.Ordinal)
                && !path.Contains("/bin/", StringComparison.Ordinal)
            )
            .GroupBy(path => Path.GetFileNameWithoutExtension(path), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal)
    );

    public string AssemblyNameOf(string project) => Property(project, "AssemblyName") ?? project;

    public string RootNamespaceOf(string project) => Property(project, "RootNamespace") ?? project.Replace(' ', '_');

    public string RootNamespaceOfAssembly(string assembly)
    {
        var project = projects.Value.Keys.Order(StringComparer.Ordinal).FirstOrDefault(name => AssemblyNameOf(name) == assembly);
        return project is null ? assembly : RootNamespaceOf(project);
    }

    private string? Property(string project, string name)
    {
        if (repository is null || !projects.Value.TryGetValue(project, out var file))
        {
            return null;
        }
        var value = XDocument
            .Parse(repository.Read(file))
            .Descendants()
            .FirstOrDefault(element => element.Name.LocalName == name)
            ?.Value.Trim();
        return string.IsNullOrEmpty(value) || value.Contains("$(", StringComparison.Ordinal) ? null : value;
    }
}
