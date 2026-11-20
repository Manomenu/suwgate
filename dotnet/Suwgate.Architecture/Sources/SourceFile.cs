using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Suwgate.Architecture.Sources;

public sealed class SourceFile(string path, string text)
{
    public string Path => path;

    public SyntaxTree Tree { get; } = CSharpSyntaxTree.ParseText(text, path: path);

    public SyntaxNode Root => Tree.GetRoot();

    public int LineOf(SyntaxNode node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return Tree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
    }
}
