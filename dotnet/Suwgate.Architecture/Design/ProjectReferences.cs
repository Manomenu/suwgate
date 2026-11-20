using System.Xml.Linq;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Design;

public sealed class ProjectReferences(RepositoryFiles repository, string solution, LayersFile layers) : IGuard
{
    public const string GuardId = "architecture/project-references";

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(layers);
        var projects = Projects();
        var unknown = projects
            .Keys.Except(layers.Projects.Keys)
            .Order(StringComparer.Ordinal)
            .Select(project => new Finding(
                project,
                $"the project is not in {layers.Path}: add it to \"projects\" with the projects it may reference and show its internals to"
            ));
        var gone = layers
            .Projects.Keys.Except(projects.Keys)
            .Order(StringComparer.Ordinal)
            .Select(project => new Finding(
                project,
                $"the project is in {layers.Path} but not in {solution}: remove it from {layers.Path}"
            ));
        var edges = projects
            .Where(project => layers.Projects.ContainsKey(project.Key))
            .OrderBy(project => project.Key, StringComparer.Ordinal)
            .SelectMany(project =>
                Compare(
                        project.Key,
                        References(project.Value),
                        layers.Projects[project.Key].References,
                        "references",
                        $"move the shared code down, or allow it in \"references\" of {project.Key} in {layers.Path} and say why in the change"
                    )
                    .Concat(
                        Compare(
                            project.Key,
                            Friends(project.Value),
                            layers.Projects[project.Key].InternalsVisibleTo,
                            "internalsVisibleTo",
                            $"make what it needs public, or allow it in \"internalsVisibleTo\" of {project.Key} in {layers.Path}"
                        )
                    )
            );
        return [.. unknown, .. gone, .. edges];
    }

    private IEnumerable<Finding> Compare(
        string project,
        IReadOnlyList<string> actual,
        IReadOnlyList<string> allowed,
        string key,
        string fix
    )
    {
        var label = key == "references" ? "->" : "internals ->";
        return actual
            .Except(allowed)
            .Order(StringComparer.Ordinal)
            .Select(other => new Finding($"{project} {label} {other}", $"{key} of {project} does not allow {other}: {fix}"))
            .Concat(
                allowed
                    .Except(actual)
                    .Order(StringComparer.Ordinal)
                    .Select(other => new Finding(
                        $"{project} {label} {other}",
                        $"{project} no longer has {other} in its {key}: remove it from \"{key}\" of {project} in {layers.Path}"
                    ))
            );
    }

    private Dictionary<string, XDocument> Projects()
    {
        var directory = Path.GetDirectoryName(solution) ?? "";
        return XDocument
            .Parse(repository.Read(solution))
            .Descendants("Project")
            .Select(project => Attribute(project, "Path").Replace('\\', '/'))
            .ToDictionary(
                path => Path.GetFileNameWithoutExtension(path),
                path => XDocument.Parse(repository.Read(Path.Combine(directory, path))),
                StringComparer.Ordinal
            );
    }

    private static string[] References(XDocument project) =>
        [
            .. project
                .Descendants("ProjectReference")
                .Select(reference => Path.GetFileNameWithoutExtension(Attribute(reference, "Include").Replace('\\', '/'))),
        ];

    private static string[] Friends(XDocument project) =>
        [.. project.Descendants("InternalsVisibleTo").Select(item => Attribute(item, "Include"))];

    private static string Attribute(XElement element, string name) =>
        (string?)element.Attribute(name) ?? throw new InvalidDataException($"<{element.Name}> has no {name} attribute");
}
