using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Suwgate.Architecture.Verification;

public static class SuwgateFile
{
    public const string Name = "suwgate.yml";

    public static IReadOnlyList<ExceptionEntry> Exceptions() => Exceptions(Find(AppContext.BaseDirectory));

    public static IReadOnlyList<ExceptionEntry> Exceptions(string path) => Read(path).Exceptions;

    public static SuwgateSettings Read(string path)
    {
        var deserializer = new DeserializerBuilder()
            .WithNamingConvention(CamelCaseNamingConvention.Instance)
            .IgnoreUnmatchedProperties()
            .Build();
        var file = deserializer.Deserialize<RawFile?>(File.ReadAllText(path)) ?? new RawFile();
        return new SuwgateSettings(
            path,
            file.Profiles ?? [],
            [
                .. (file.Exceptions ?? []).Select(raw => new ExceptionEntry(
                    raw.Guard ?? throw Invalid(path, "an exception has no guard"),
                    raw.Target ?? throw Invalid(path, $"the exception from {raw.Guard} has no target"),
                    string.IsNullOrWhiteSpace(raw.Reason)
                        ? throw Invalid(path, $"the exception from {raw.Guard} for {raw.Target} has no reason: say why it exists")
                        : raw.Reason
                )),
            ],
            [
                .. (file.Guards?.Skip ?? []).Select(raw => new GuardSkip(
                    raw.Guard ?? throw Invalid(path, "a skipped guard has no guard"),
                    string.IsNullOrWhiteSpace(raw.Reason)
                        ? throw Invalid(path, $"the skipped guard {raw.Guard} has no reason: say why it does not apply")
                        : raw.Reason
                )),
            ],
            (file.Settings ?? []).ToDictionary(
                setting => setting.Key,
                setting =>
                    (IReadOnlyDictionary<string, string>)
                        (setting.Value ?? [])
                            .Where(pair => pair.Value is string)
                            .ToDictionary(pair => pair.Key, pair => (string)pair.Value),
                StringComparer.Ordinal
            )
        );
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
        public string[]? Profiles { get; set; }

        public RawException[]? Exceptions { get; set; }

        public RawGuards? Guards { get; set; }

        public Dictionary<string, Dictionary<string, object>?>? Settings { get; set; }
    }

    private sealed class RawException
    {
        public string? Guard { get; set; }

        public string? Target { get; set; }

        public string? Reason { get; set; }
    }

    private sealed class RawGuards
    {
        public RawSkip[]? Skip { get; set; }
    }

    private sealed class RawSkip
    {
        public string? Guard { get; set; }

        public string? Reason { get; set; }
    }
}
