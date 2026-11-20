using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class EveryProjectGuardedTests
{
    private static readonly System.Reflection.Assembly Server = SampleAssembly.Compile(
        "Sample.Guarded",
        "namespace Sample.Guarded.Api { public static class ServerApp { public static int Port => 80; } }"
    );

    private static readonly LayersFile Layers = LayersFile.Parse(
        "Gate/layers.json",
        """
        {
          "projects": {
            "Sample.Guarded": { "layers": ["Api"] },
            "Sample.Guarded.Tests": { "references": ["Sample.Guarded"] },
            "Sample.Worker": {},
            "Sample.Flat": { "layers": [] }
          }
        }
        """
    );

    [Fact]
    public void Every_production_project_read_by_the_guards_and_layered_passes() =>
        Assert.Empty(
            new EveryProjectGuarded(
                LayersFile.Parse("layers.json", """{ "projects": { "Sample.Guarded": { "layers": ["Api"] } } }"""),
                Server
            ).Check()
        );

    [Fact]
    public void A_project_the_guards_never_read_or_without_layers_is_found_with_the_fix_and_test_projects_are_skipped()
    {
        var findings = new EveryProjectGuarded(Layers, Server).Check().ToList();

        Assert.Equal(["Sample.Flat", "Sample.Worker", "Sample.Flat", "Sample.Worker"], findings.Select(f => f.Target));
        Assert.StartsWith(
            "the guards over types never read it: add typeof(<a type of Sample.Flat>).Assembly",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith("it has no layers: give it \"layers\" in Gate/layers.json", findings[2].Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_gate_project_that_references_the_guard_packages_needs_neither_layers_nor_an_exception()
    {
        SampleAssembly.CompileLoadable(
            "Sample.Gate",
            "namespace Sample.Gate { public static class Wiring { public static System.Type Guard => typeof(Suwgate.Architecture.Verification.IGuard); } }"
        );
        var layers = LayersFile.Parse(
            "layers.json",
            """{ "projects": { "Sample.Guarded": { "layers": ["Api"] }, "Sample.Gate": { "references": ["Sample.Guarded"] } } }"""
        );

        Assert.Empty(new EveryProjectGuarded(layers, Server).Check());
    }

    [Fact]
    public void A_project_that_builds_under_another_assembly_name_is_read_by_that_name()
    {
        using var repository = new TemporaryRepository(
            new Dictionary<string, string>
            {
                ["layers.json"] = """{ "projects": { "Sample.Cli": { "layers": ["Api"] }, "Sample.Other": { "layers": ["Api"] } } }""",
                ["Sample.Cli/Sample.Cli.csproj"] =
                    "<Project><PropertyGroup><AssemblyName>Sample.Guarded</AssemblyName></PropertyGroup></Project>",
                ["Sample.Other/Sample.Other.csproj"] =
                    "<Project><PropertyGroup><AssemblyName>$(MSBuildProjectName)</AssemblyName></PropertyGroup></Project>",
            }
        );
        var layers = LayersFile.Read(repository.Files, "layers.json");

        Assert.Equal("Sample.Guarded", layers.AssemblyNameOf("Sample.Cli"));
        Assert.Equal("Sample.Other", layers.AssemblyNameOf("Sample.Other"));
        Assert.Equal("Sample.Missing", layers.AssemblyNameOf("Sample.Missing"));
        Assert.Equal(["Sample.Other"], new EveryProjectGuarded(layers, Server).Check().Select(finding => finding.Target));
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new EveryProjectGuarded(Layers, Server));
}
