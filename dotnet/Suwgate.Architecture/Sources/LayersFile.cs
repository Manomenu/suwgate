using System.Text.Json;

namespace Suwgate.Architecture.Sources;

public sealed class LayersFile(string path, IReadOnlyDictionary<string, ProjectRules> projects)
{
    public string Path => path;

    public IReadOnlyDictionary<string, ProjectRules> Projects => projects;

    public static LayersFile Read(RepositoryFiles repository, string path)
    {
        ArgumentNullException.ThrowIfNull(repository);
        return Parse(path, repository.Read(path));
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
