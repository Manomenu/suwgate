using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Code;

public sealed class NoEscapeHatches(IReadOnlyCollection<SourceFile> files) : IGuard
{
    public const string GuardId = "architecture/no-escape-hatches";

    public string Id => GuardId;

    public IEnumerable<Finding> Check() =>
        files
            .OrderBy(file => file.Path, StringComparer.Ordinal)
            .SelectMany(file =>
                file.Root.DescendantNodes()
                    .Select(node => (node, fix: FixOf(node)))
                    .Where(item => item.fix is not null)
                    .Select(item => new Finding(file.Path, $"line {file.LineOf(item.node)}: {item.fix}"))
            );

    private static string? FixOf(SyntaxNode node) =>
        node switch
        {
            IdentifierNameSyntax { Identifier.Text: "dynamic" } =>
                "`dynamic` switches the compiler off: give it a real type (a record, a generic)",
            _ when node.IsKind(SyntaxKind.SuppressNullableWarningExpression) =>
                "remove the null-forgiving `!`: check for null and say what happens then, or fix the type so that it cannot be null",
            _ => null,
        };
}
