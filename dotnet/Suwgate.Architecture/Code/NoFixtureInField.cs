using Microsoft.CodeAnalysis.CSharp.Syntax;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Code;

public sealed class NoFixtureInField(IReadOnlyCollection<SourceFile> files, string fieldType, string classFixture) : IGuard
{
    public const string GuardId = "architecture/no-fixture-in-field";

    public string Id => GuardId;

    public IEnumerable<Finding> Check() =>
        files
            .OrderBy(file => file.Path, StringComparer.Ordinal)
            .SelectMany(file =>
                file.Root.DescendantNodes()
                    .OfType<FieldDeclarationSyntax>()
                    .Where(field => field.Declaration.Type.ToString() == fieldType)
                    .Select(field => new Finding(
                        file.Path,
                        $"line {file.LineOf(field)}: a {fieldType} field starts one for every test: take it from the class fixture "
                            + $"(IClassFixture<{classFixture}>, through the constructor) and read it through a property; "
                            + $"a test that needs other settings makes its own {fieldType} in a using inside the test"
                    ))
            );
}
