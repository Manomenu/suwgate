using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Suwgate.Architecture.Sources;

internal sealed class SourceNames(IEnumerable<SourceFile> files)
{
    private readonly List<(string Type, string? Member, IReadOnlyList<string> Inside)> names =
    [
        .. files.SelectMany(file =>
            file.Root.DescendantNodes()
                .OfType<AttributeArgumentSyntax>()
                .SelectMany(argument => argument.DescendantNodesAndSelf().OfType<SimpleNameSyntax>())
                .Select(name => (name.Identifier.Text, (string?)null, Inside(name)))
                .Concat(
                    file.Root.DescendantNodes()
                        .OfType<MemberAccessExpressionSyntax>()
                        .Where(access => Rightmost(access.Expression) is not null)
                        .Select(access => (Rightmost(access.Expression) ?? "", (string?)access.Name.Identifier.Text, Inside(access)))
                )
        ),
    ];

    public bool NamedInAttribute(string type) => names.Any(name => name.Member is null && name.Type == type && !name.Inside.Contains(type));

    public bool NamesMember(string type, IReadOnlyCollection<string> members) =>
        names.Any(name => name.Type == type && name.Member is { } member && members.Contains(member) && !name.Inside.Contains(type));

    private static string? Rightmost(ExpressionSyntax expression) =>
        expression switch
        {
            SimpleNameSyntax name => name.Identifier.Text,
            MemberAccessExpressionSyntax access => access.Name.Identifier.Text,
            AliasQualifiedNameSyntax alias => alias.Name.Identifier.Text,
            _ => null,
        };

    private static string[] Inside(SyntaxNode node) =>
        [.. node.Ancestors().OfType<BaseTypeDeclarationSyntax>().Select(type => type.Identifier.Text)];
}
