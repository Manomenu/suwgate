using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Suwgate.Architecture.Sources;

public sealed class SourceFile(string path, string text)
{
    public string Path => path;

    public SyntaxTree Tree { get; } = CSharpSyntaxTree.ParseText(text, path: path);

    public SyntaxNode Root => Tree.GetRoot();

    public bool InTestProject => path.Split('/')[..^1].Any(folder => folder.EndsWith(".Tests", StringComparison.Ordinal));

    public int LineOf(SyntaxNode node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return Tree.GetLineSpan(node.Span).StartLinePosition.Line + 1;
    }
}
