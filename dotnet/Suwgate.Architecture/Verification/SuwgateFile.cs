using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Suwgate.Architecture.Verification;

public static class SuwgateFile
{
    public const string Name = "suwgate.yml";

    public static IReadOnlyList<ExceptionEntry> Exceptions() => Exceptions(Find(AppContext.BaseDirectory));

    public static IReadOnlyList<ExceptionEntry> Exceptions(string path)
    {
        var deserializer = new DeserializerBuilder()
            .WithNamingConvention(CamelCaseNamingConvention.Instance)
            .IgnoreUnmatchedProperties()
            .Build();
        var file = deserializer.Deserialize<RawFile?>(File.ReadAllText(path)) ?? new RawFile();
        return
        [
            .. (file.Exceptions ?? []).Select(raw => new ExceptionEntry(
                raw.Guard ?? throw Invalid(path, "an exception has no guard"),
                raw.Target ?? throw Invalid(path, $"the exception from {raw.Guard} has no target"),
                string.IsNullOrWhiteSpace(raw.Reason)
                    ? throw Invalid(path, $"the exception from {raw.Guard} for {raw.Target} has no reason: say why it exists")
                    : raw.Reason
            )),
        ];
    }

    public static string Find(string startDirectory)
    {
        for (var directory = new DirectoryInfo(startDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, Name);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }
        throw new FileNotFoundException(
            $"no {Name} in {startDirectory} or above it: the guards read their exceptions from the repository's {Name}"
        );
    }

    private static InvalidDataException Invalid(string path, string problem) =>
        new($"{path}: {problem} (suwgate check validates the file with its schema and says more)");

    private sealed class RawFile
    {
        public RawException[]? Exceptions { get; set; }
    }

    private sealed class RawException
    {
        public string? Guard { get; set; }

        public string? Target { get; set; }

        public string? Reason { get; set; }
    }
}
