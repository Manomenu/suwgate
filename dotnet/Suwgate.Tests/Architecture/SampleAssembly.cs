using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.Loader;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Suwgate.Tests.Architecture;

internal static class SampleAssembly
{
    private static readonly ConcurrentDictionary<string, Assembly> Compiled = new(StringComparer.Ordinal);

    private static readonly Lazy<MetadataReference[]> Platform = new(() =>
        [
            .. (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "")
                .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
                .Select(path => MetadataReference.CreateFromFile(path)),
        ]
    );

    public static Assembly Compile(string name, string source) => Compiled.GetOrAdd(name, _ => Emit(name, source));

    private static Assembly Emit(string name, string source)
    {
        var compilation = CSharpCompilation.Create(
            name,
            [CSharpSyntaxTree.ParseText(source)],
            Platform.Value,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, nullableContextOptions: NullableContextOptions.Enable)
        );
        var directory = Directory.CreateTempSubdirectory("suwgate-sample-");
        var path = Path.Combine(directory.FullName, name + ".dll");
        var result = compilation.Emit(path);
        if (!result.Success)
        {
            throw new InvalidOperationException(
                string.Join(Environment.NewLine, result.Diagnostics.Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error))
            );
        }
        return new AssemblyLoadContext(name).LoadFromAssemblyPath(path);
    }
}
