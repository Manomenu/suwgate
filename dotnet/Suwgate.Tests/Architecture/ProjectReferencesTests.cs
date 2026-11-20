using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class ProjectReferencesTests
{
    private const string Solution = """
        <Solution>
          <Project Path="App.Server/App.Server.csproj" />
          <Project Path="App.Server.Tests/App.Server.Tests.csproj" />
          <Project Path="App.Gate/App.Gate.csproj" />
        </Solution>
        """;

    private const string Server = """
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup><InternalsVisibleTo Include="App.Server.Tests" /></ItemGroup>
        </Project>
        """;

    private const string ServerTests = """
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup><ProjectReference Include="..\App.Server\App.Server.csproj" /></ItemGroup>
        </Project>
        """;

    private const string Gate = """
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup><ProjectReference Include="../App.Server/App.Server.csproj" /></ItemGroup>
        </Project>
        """;

    private static TemporaryRepository Repository(string gate) =>
        new(
            new Dictionary<string, string>
            {
                ["App.slnx"] = Solution,
                ["App.Server/App.Server.csproj"] = Server,
                ["App.Server.Tests/App.Server.Tests.csproj"] = ServerTests,
                ["App.Gate/App.Gate.csproj"] = gate,
            }
        );

    private static readonly LayersFile Allowed = LayersFile.Parse(
        "App.Gate/layers.json",
        """
        {
          "projects": {
            "App.Server": { "layers": ["Api"], "internalsVisibleTo": ["App.Server.Tests"] },
            "App.Server.Tests": { "references": ["App.Server"] },
            "App.Gate": { "references": ["App.Server"] }
          }
        }
        """
    );

    [Fact]
    public void References_and_friends_the_table_allows_pass()
    {
        using var repository = Repository(Gate);

        Assert.Empty(new ProjectReferences(repository.Files, "App.slnx", Allowed).Check());
    }

    [Fact]
    public void A_reference_the_table_does_not_allow_one_it_lists_in_vain_and_an_unknown_project_are_found_with_the_fix()
    {
        using var repository = Repository(
            """
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup><ProjectReference Include="../App.Server.Tests/App.Server.Tests.csproj" /></ItemGroup>
              <ItemGroup><InternalsVisibleTo Include="App.Server" /></ItemGroup>
            </Project>
            """
        );
        var layers = LayersFile.Parse(
            "App.Gate/layers.json",
            """
            {
              "projects": {
                "App.Server": { "internalsVisibleTo": ["App.Server.Tests"] },
                "App.Gate": { "references": ["App.Server"] },
                "App.Old": {}
              }
            }
            """
        );

        var findings = new ProjectReferences(repository.Files, "App.slnx", layers).Check().ToList();

        Assert.Equal(
            ["App.Server.Tests", "App.Old", "App.Gate -> App.Server.Tests", "App.Gate -> App.Server", "App.Gate internals -> App.Server"],
            findings.Select(f => f.Target)
        );
        Assert.StartsWith(
            "the project is not in App.Gate/layers.json: add it to \"projects\"",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.Equal(
            "the project is in App.Gate/layers.json but not in App.slnx: remove it from App.Gate/layers.json",
            findings[1].Message
        );
        Assert.StartsWith(
            "references of App.Gate does not allow App.Server.Tests: move the shared code down",
            findings[2].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith("App.Gate no longer has App.Server in its references: remove it", findings[3].Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails()
    {
        using var repository = Repository(Gate);
        var layers = LayersFile.Parse("layers.json", """{ "projects": { "App.Server": {}, "App.Gate": {} } }""");

        GuardAssert.HonoursExceptions(new ProjectReferences(repository.Files, "App.slnx", layers));
    }
}
