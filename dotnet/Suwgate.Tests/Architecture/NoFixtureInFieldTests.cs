using Suwgate.Architecture.Code;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class NoFixtureInFieldTests
{
    private static NoFixtureInField Guard(string text) => new([new SourceFile("App.Tests/NotesTests.cs", text)], "TestApp", "ClassServer");

    [Fact]
    public void A_server_taken_from_the_class_fixture_passes() =>
        Assert.Empty(
            Guard("public sealed class NotesTests(ClassServer server) : IClassFixture<ClassServer> { private TestApp App => server.App; }")
                .Check()
        );

    [Fact]
    public void A_server_started_in_a_field_is_found_with_the_line_and_the_fix()
    {
        var finding = Assert.Single(Guard("public sealed class NotesTests\n{\n    private readonly TestApp app = new();\n}").Check());

        Assert.Equal("App.Tests/NotesTests.cs", finding.Target);
        Assert.StartsWith(
            "line 3: a TestApp field starts one for every test: take it from the class fixture (IClassFixture<ClassServer>, through the constructor)",
            finding.Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(Guard("class NotesTests { TestApp app = new(); }"));
}
