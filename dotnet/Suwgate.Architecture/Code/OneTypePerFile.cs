using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Code;

public sealed class OneTypePerFile(IReadOnlyCollection<SourceFile> files) : IGuard
{
    public const string GuardId = "architecture/one-type-per-file";

    public string Id => GuardId;

    public IEnumerable<Finding> Check() => files.OrderBy(file => file.Path, StringComparer.Ordinal).SelectMany(FindingsOf);

    private static IEnumerable<Finding> FindingsOf(SourceFile file)
    {
        var names = file.Root.DescendantNodes(node => node is not TypeDeclarationSyntax).Select(NameOf).OfType<string>().ToList();
        var stem = Path.GetFileNameWithoutExtension(file.Path);
        if (names.Count > 1)
        {
            yield return new Finding(
                file.Path,
                $"{names.Count} top-level types ({string.Join(", ", names)}): move each into a file of its own"
            );
        }
        else if (names.Count == 1 && names[0] != stem)
        {
            yield return new Finding(file.Path, $"it holds {names[0]}: rename the file to {names[0]}.cs, or the type to {stem}");
        }
    }

    private static string? NameOf(SyntaxNode node) =>
        node switch
        {
            BaseTypeDeclarationSyntax type => type.Identifier.Text,
            DelegateDeclarationSyntax @delegate => @delegate.Identifier.Text,
            _ => null,
        };
}
