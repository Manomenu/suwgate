using System.Text.Json;

namespace Suwgate.Architecture.Sources;

public sealed class LayersFile(string path, IReadOnlyDictionary<string, ProjectRules> projects, RepositoryFiles? repository = null)
{
    public const string Root = ".";

    private readonly ProjectNames names = new(repository);

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
            projects.EnumerateObject().ToDictionary(project => project.Name, project => Rules(path, project), StringComparer.Ordinal)
        );
    }

    public IReadOnlyList<IReadOnlyList<string>> LevelsOf(string project) =>
        projects.TryGetValue(project, out var rules) ? [.. rules.Layers.Select(Parts)] : [];

    public string AssemblyNameOf(string project) => names.AssemblyNameOf(project);

    public string RootNamespaceOf(string project)
    {
        ArgumentNullException.ThrowIfNull(project);
        return names.RootNamespaceOf(project);
    }

    internal static string[] Parts(string level) =>
        level.Split('|', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static ProjectRules Rules(string path, JsonProperty project)
    {
        var layers = Strings(path, project.Name, project.Value, "layers");
        var areas = Areas(path, project);
        var parts = layers.SelectMany(Parts).ToHashSet(StringComparer.Ordinal);
        var stray = areas.Keys.FirstOrDefault(area => !parts.Contains(area) || area == Root);
        if (stray is not null)
        {
            throw Invalid(
                path,
                $"\"areas\" of {project.Name} names {stray}, which is not a part of its \"layers\": put the area on a level of the layers first"
            );
        }
        return new ProjectRules(
            layers,
            Strings(path, project.Name, project.Value, "references"),
            Strings(path, project.Name, project.Value, "internalsVisibleTo")
        )
        {
            Areas = areas,
            SubFeatures = SubFeatures(path, project),
        };
    }

    private static Dictionary<string, IReadOnlyList<string>> Areas(string path, JsonProperty project)
    {
        if (!project.Value.TryGetProperty("areas", out var areas))
        {
            return new(StringComparer.Ordinal);
        }
        if (areas.ValueKind != JsonValueKind.Object)
        {
            throw Invalid(path, $"\"areas\" of {project.Name} is not an object of area name to its layers");
        }
        return areas
            .EnumerateObject()
            .ToDictionary(
                area => area.Name,
                area => (IReadOnlyList<string>)Strings(path, $"\"areas\" of {project.Name}: {area.Name}", area.Value),
                StringComparer.Ordinal
            );
    }

    private static bool SubFeatures(string path, JsonProperty project)
    {
        if (!project.Value.TryGetProperty("subFeatures", out var value))
        {
            return false;
        }
        return value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : throw Invalid(path, $"\"subFeatures\" of {project.Name} is not true or false");
    }

    private static string[] Strings(string path, string owner, JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var array) ? Strings(path, $"\"{name}\" of {owner}", array) : [];

    private static string[] Strings(string path, string what, JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            throw Invalid(path, $"{what} is not an array of strings");
        }
        return [.. array.EnumerateArray().Select(item => item.GetString() ?? throw Invalid(path, $"{what} holds a non-string"))];
    }

    private static InvalidDataException Invalid(string path, string problem) => new($"{path}: {problem}");
}
