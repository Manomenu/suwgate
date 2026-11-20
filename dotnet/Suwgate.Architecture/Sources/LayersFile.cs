using System.Text.Json;
using System.Xml.Linq;

namespace Suwgate.Architecture.Sources;

public sealed class LayersFile(string path, IReadOnlyDictionary<string, ProjectRules> projects, RepositoryFiles? repository = null)
{
    public string Path => path;

    public IReadOnlyDictionary<string, ProjectRules> Projects => projects;

    public static LayersFile Read(RepositoryFiles repository, string path)
    {
        ArgumentNullException.ThrowIfNull(repository);
        return new(path, Parse(path, repository.Read(path)).Projects, repository);
    }

    public static LayersFile Parse(string path, string json)
    {
        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("projects", out var projects) || projects.ValueKind != JsonValueKind.Object)
        {
            throw Invalid(path, "it has no \"projects\" object: list every project of the solution there");
        }
        return new(
            path,
            projects
                .EnumerateObject()
                .ToDictionary(
                    project => project.Name,
                    project => new ProjectRules(
                        Strings(path, project, "layers"),
                        Strings(path, project, "references"),
                        Strings(path, project, "internalsVisibleTo")
                    ),
                    StringComparer.Ordinal
                )
        );
    }

    public IReadOnlyList<IReadOnlyList<string>> LevelsOf(string project) =>
        projects.TryGetValue(project, out var rules)
            ? [.. rules.Layers.Select(level => level.Split('|', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))]
            : [];

    public string AssemblyNameOf(string project)
    {
        var file = repository?.Paths.FirstOrDefault(candidate =>
            System.IO.Path.GetFileName(candidate) == project + ".csproj"
            && !candidate.Contains("/obj/", StringComparison.Ordinal)
            && !candidate.Contains("/bin/", StringComparison.Ordinal)
        );
        if (repository is null || file is null)
        {
            return project;
        }
        var name = XDocument
            .Parse(repository.Read(file))
            .Descendants()
            .FirstOrDefault(element => element.Name.LocalName == "AssemblyName")
            ?.Value.Trim();
        return string.IsNullOrEmpty(name) || name.Contains("$(", StringComparison.Ordinal) ? project : name;
    }

    private static string[] Strings(string path, JsonProperty project, string name)
    {
        if (!project.Value.TryGetProperty(name, out var array))
        {
            return [];
        }
        if (array.ValueKind != JsonValueKind.Array)
        {
            throw Invalid(path, $"\"{name}\" of {project.Name} is not an array of strings");
        }
        return
        [
            .. array
                .EnumerateArray()
                .Select(item => item.GetString() ?? throw Invalid(path, $"\"{name}\" of {project.Name} holds a non-string")),
        ];
    }

    private static InvalidDataException Invalid(string path, string problem) => new($"{path}: {problem}");
}
