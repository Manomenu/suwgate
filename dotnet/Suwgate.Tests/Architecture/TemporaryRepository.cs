using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

internal sealed class TemporaryRepository : IDisposable
{
    private readonly DirectoryInfo root = Directory.CreateTempSubdirectory("suwgate-repository-");

    public TemporaryRepository(IReadOnlyDictionary<string, string> files)
    {
        foreach (var (path, text) in files)
        {
            var full = Path.Combine(root.FullName, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full) ?? root.FullName);
            File.WriteAllText(full, text);
        }
        Files = new RepositoryFiles(root.FullName, [.. files.Keys]);
    }

    public RepositoryFiles Files { get; }

    public void Dispose() => root.Delete(recursive: true);
}
