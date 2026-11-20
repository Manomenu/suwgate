using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Sources;

public sealed class RepositoryFiles(string root, IReadOnlyList<string> paths)
{
    public string Root => root;

    public IReadOnlyList<string> Paths => paths;

    public static RepositoryFiles Find() =>
        Of(
            Path.GetDirectoryName(SuwgateFile.Find(AppContext.BaseDirectory))
                ?? throw new InvalidOperationException($"{SuwgateFile.Name} has no directory")
        );

    public static RepositoryFiles Of(string root)
    {
        var listed = Git.Run(root, "ls-files", "--cached", "--others", "--exclude-standard");
        if (!listed.Succeeded)
        {
            throw new InvalidOperationException($"git ls-files failed in {root}: {listed.Error}");
        }
        return new(
            root,
            [
                .. listed
                    .Output.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(path => path.TrimEnd('\r'))
                    .Where(path => File.Exists(Path.Combine(root, path))),
            ]
        );
    }

    public string Read(string path) => File.ReadAllText(Path.Combine(root, path));

    public IReadOnlyList<SourceFile> CSharpSources() => CSharpSources("");

    public IReadOnlyList<SourceFile> CSharpSources(string under) =>
        [
            .. paths
                .Where(path => path.StartsWith(under, StringComparison.Ordinal) && path.EndsWith(".cs", StringComparison.Ordinal))
                .Where(path => !path.Contains("/obj/", StringComparison.Ordinal) && !path.Contains("/bin/", StringComparison.Ordinal))
                .Where(path =>
                    !path.EndsWith(".g.cs", StringComparison.Ordinal) && !path.EndsWith(".Designer.cs", StringComparison.Ordinal)
                )
                .Select(path => new SourceFile(path, Read(path))),
        ];
}
