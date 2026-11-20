using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Code;

public sealed class NoFixtureInField(IReadOnlyCollection<SourceFile> files, IReadOnlyCollection<string> serverTypes, string classFixture)
    : IGuard
{
    public const string GuardId = "architecture/no-fixture-in-field";

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        var servers = ServerTypes();
        return files
            .OrderBy(file => file.Path, StringComparer.Ordinal)
            .SelectMany(file =>
                file.Root.DescendantNodes()
                    .OfType<TypeDeclarationSyntax>()
                    .Where(IsTestClass)
                    .SelectMany(test => Starts(test, servers))
                    .Select(start => new Finding(
                        file.Path,
                        $"line {file.LineOf(start.member)}: {start.server} starts in a field, so once for every test (xUnit makes the class anew "
                            + $"for each): take it from the class fixture (IClassFixture<{classFixture}>, through the constructor) and read it "
                            + $"through a property; a test that needs other settings makes its own in a using inside the test"
                    ))
            );
    }

    private HashSet<string> ServerTypes()
    {
        var known = serverTypes.ToHashSet(StringComparer.Ordinal);
        var declarations = files.SelectMany(file => file.Root.DescendantNodes().OfType<TypeDeclarationSyntax>()).ToList();
        int added;
        do
        {
            added = declarations
                .Where(declaration => !known.Contains(declaration.Identifier.Text))
                .Where(declaration => declaration.BaseList?.Types.Any(type => known.Contains(SimpleName(type.Type))) == true)
                .Count(declaration => known.Add(declaration.Identifier.Text));
        } while (added > 0);
        return known;
    }

    private static bool IsTestClass(TypeDeclarationSyntax type) =>
        type
            .Members.OfType<MethodDeclarationSyntax>()
            .SelectMany(method => method.AttributeLists.SelectMany(list => list.Attributes))
            .Select(attribute => SimpleName(attribute.Name))
            .Any(name => name.EndsWith("Fact", StringComparison.Ordinal) || name.EndsWith("Theory", StringComparison.Ordinal));

    private static IEnumerable<(SyntaxNode member, string server)> Starts(TypeDeclarationSyntax test, HashSet<string> servers)
    {
        var fields = test
            .Members.OfType<FieldDeclarationSyntax>()
            .SelectMany(field =>
                field.Declaration.Variables.Select(variable =>
                    ((SyntaxNode)field, (TypeSyntax?)field.Declaration.Type, variable.Initializer?.Value)
                )
            );
        var properties = test
            .Members.OfType<PropertyDeclarationSyntax>()
            .Select(property => ((SyntaxNode)property, (TypeSyntax?)property.Type, property.Initializer?.Value));
        var assigned = test
            .Members.OfType<ConstructorDeclarationSyntax>()
            .SelectMany(constructor => constructor.DescendantNodes().OfType<AssignmentExpressionSyntax>())
            .Select(assignment => ((SyntaxNode)assignment, (TypeSyntax?)null, (ExpressionSyntax?)assignment.Right));
        return fields
            .Concat(properties)
            .Concat(assigned)
            .Select(item => (member: item.Item1, server: Started(item.Item2, item.Item3, servers)))
            .Where(item => item.server is not null)
            .Select(item => (item.member, item.server ?? ""));
    }

    private static string? Started(TypeSyntax? declared, ExpressionSyntax? value, HashSet<string> servers)
    {
        var name = value switch
        {
            ObjectCreationExpressionSyntax creation => SimpleName(creation.Type),
            ImplicitObjectCreationExpressionSyntax when declared is not null => SimpleName(declared),
            InvocationExpressionSyntax { Expression: MemberAccessExpressionSyntax access } => SimpleName(access.Expression),
            _ => null,
        };
        return name is not null && servers.Contains(name) ? name : null;
    }

    private static string SimpleName(SyntaxNode type) =>
        type switch
        {
            QualifiedNameSyntax qualified => SimpleName(qualified.Right),
            AliasQualifiedNameSyntax alias => SimpleName(alias.Name),
            MemberAccessExpressionSyntax access => SimpleName(access.Name),
            GenericNameSyntax generic => generic.Identifier.Text,
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            NullableTypeSyntax nullable => SimpleName(nullable.ElementType),
            _ => type.ToString(),
        };
}
