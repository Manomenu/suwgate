using Suwgate.Architecture.Profiles;
using Suwgate.Architecture.Verification;

namespace Suwgate.Tests.Profiles;

internal sealed class WiredRepository : IDisposable
{
    private static readonly IReadOnlyDictionary<string, string> Files = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["Wired.slnx"] = "<Solution><Project Path=\"Wired/Wired.csproj\" /></Solution>",
        ["Wired/Wired.csproj"] = "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>",
        ["layers.json"] = "{ \"projects\": { \"Sample.Wired\": { \"layers\": [\"Api\", \"Notes\"] } } }",
        ["Wired/Api/ServerApp.cs"] = "namespace Wired.Api;\n\npublic static class ServerApp { }\n",
        ["Wired/Database/Migrations/up/0001_notes.sql"] = "select 1;",
    };

    private readonly Architecture.TemporaryRepository repository;

    private readonly DirectoryInfo evidence = Directory.CreateTempSubdirectory("suwgate-evidence-");

    public WiredRepository(IReadOnlyDictionary<string, string>? more = null)
    {
        var files = new Dictionary<string, string>(Files, StringComparer.Ordinal);
        foreach (var (path, text) in more ?? new Dictionary<string, string>())
        {
            files[path] = text;
        }
        repository = new Architecture.TemporaryRepository(files);
    }

    public static System.Reflection.Assembly Server { get; } =
        Architecture.SampleAssembly.Compile(
            "Sample.Wired",
            """
            namespace Sample.Wired.Api { public static class ServerApp { public static int Map() => Sample.Wired.Notes.NotesEndpoints.Map(); } }
            namespace Sample.Wired.Notes { public static class NotesEndpoints { public static int Map() => 1; } }
            """
        );

    public static Type ServerApp { get; } = Server.GetType("Sample.Wired.Api.ServerApp", throwOnError: true) ?? typeof(object);

    public Suwgate.Architecture.Sources.RepositoryFiles Repository => repository.Files;

    public IReadOnlyList<string> Recorded() =>
        [.. evidence.EnumerateFiles().SelectMany(file => File.ReadAllLines(file.FullName)).Order(StringComparer.Ordinal)];

    public GuardFailedException? Verify(SuwgateSettings settings, GuardInputs inputs, params IGuardProfile[] profiles) =>
        Record.Exception(() => SuwgateGuards.Verify(inputs, profiles, settings, repository.Files, new Evidence(evidence.FullName)))
        as GuardFailedException;

    public static SuwgateSettings Settings(
        IReadOnlyList<string> profiles,
        IReadOnlyList<GuardSkip>? skipped = null,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? settings = null
    ) =>
        new(
            "suwgate.yml",
            profiles,
            [],
            skipped ?? [],
            settings ?? new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal)
        );

    public void Dispose()
    {
        repository.Dispose();
        evidence.Delete(recursive: true);
    }
}
