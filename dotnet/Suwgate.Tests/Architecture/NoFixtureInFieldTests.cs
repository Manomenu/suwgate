using Suwgate.Architecture.Code;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class NoFixtureInFieldTests
{
    private const string ClassServer = """
        public sealed class ClassServer : IAsyncDisposable
        {
            internal WebApplicationFactory<Program> App { get; } = RunTestApp.Create();
        }
        """;

    private const string TestApp = "internal sealed class TestApp : WebApplicationFactory<Program> { }";

    private static NoFixtureInField Guard(string text) =>
        new(
            [
                new SourceFile("App.Tests/ClassServer.cs", ClassServer),
                new SourceFile("App.Tests/TestApp.cs", TestApp),
                new SourceFile("App.Tests/NotesTests.cs", text),
            ],
            ["WebApplicationFactory", "TestServer", "RunTestApp"],
            "ClassServer"
        );

    [Fact]
    public void A_server_taken_from_the_class_fixture_or_made_inside_a_test_passes_and_the_fixture_itself_may_start_it() =>
        Assert.Empty(
            Guard(
                    """
                    public sealed class NotesTests(ClassServer server) : IClassFixture<ClassServer>
                    {
                        private readonly WebApplicationFactory<Program> app = server.App;
                        private TestApp Other => server.Other;

                        [Fact]
                        public async Task Lists_notes() { await using var own = new TestApp(); }
                    }
                    """
                )
                .Check()
        );

    [Fact]
    public void A_server_started_in_a_field_property_or_constructor_of_a_test_class_is_found_with_the_line_and_the_fix()
    {
        var findings = Guard(
                """
                public sealed class NotesTests
                {
                    private readonly TestApp app = new();
                    private readonly WebApplicationFactory<Program> factory = RunTestApp.Create();
                    private Microsoft.AspNetCore.TestHost.TestServer Server { get; } = new Microsoft.AspNetCore.TestHost.TestServer(null);
                    private readonly WebApplicationFactory<Program> later;

                    public NotesTests() { later = new WebApplicationFactory<Program>(); }

                    [Theory]
                    public void Lists_notes() { }
                }
                """
            )
            .Check()
            .ToList();

        Assert.Equal(["line 3", "line 4", "line 5", "line 8"], findings.Select(finding => finding.Message.Split(':')[0]));
        Assert.All(findings, finding => Assert.Equal("App.Tests/NotesTests.cs", finding.Target));
        Assert.StartsWith(
            "line 3: TestApp starts in a field, so once for every test (xUnit makes the class anew for each): take it from the class fixture "
                + "(IClassFixture<ClassServer>, through the constructor)",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith("line 4: RunTestApp starts in a field", findings[1].Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_class_without_tests_is_not_a_test_class() =>
        Assert.Empty(Guard("public sealed class Helper { private readonly TestApp app = new(); }").Check());

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(Guard("class NotesTests { TestApp app = new(); [Fact] void A() { } }"));
}
