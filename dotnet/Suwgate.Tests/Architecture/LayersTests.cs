using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class LayersTests
{
    private const string LayersJson = """
        {
          "projects": {
            "Sample.Layered": { "layers": ["Api", "Notes | Health", "Database"] },
            "Sample.Crossed": { "layers": ["Api", "Notes | Health", "Database"] }
          }
        }
        """;

    private static readonly LayersFile File = LayersFile.Parse("Gate/layers.json", LayersJson);

    private static readonly System.Reflection.Assembly Layered = SampleAssembly.Compile(
        "Sample.Layered",
        """
        namespace Sample.Layered.Api { public static class ServerApp { public static int Start() => Sample.Layered.Notes.NoteList.Count() + Sample.Layered.Health.Probe.Check(); } }
        namespace Sample.Layered.Notes { public static class NoteList { public static int Count() => Sample.Layered.Database.Store.Rows(); } }
        namespace Sample.Layered.Health { public static class Probe { public static int Check() => Sample.Layered.Database.Store.Rows(); } }
        namespace Sample.Layered.Database { public static class Store { public static int Rows() => 1; } }
        """
    );

    private static readonly System.Reflection.Assembly Crossed = SampleAssembly.Compile(
        "Sample.Crossed",
        """
        namespace Sample.Crossed.Api { public static class ServerApp { public static int Port { get; } = 80; } }
        namespace Sample.Crossed.Notes { public static class NoteList { public static int Count() => 1; } }
        namespace Sample.Crossed.Health { public static class Probe { public static int Check() => Sample.Crossed.Notes.NoteList.Count(); } }
        namespace Sample.Crossed.Database { public static class Store { public static int Rows() => Sample.Crossed.Api.ServerApp.Port; } }
        namespace Sample.Crossed.Billing { public static class Invoice { public static int Total() => 2; } }
        """
    );

    [Fact]
    public void A_layer_that_uses_only_the_layers_below_it_passes() => Assert.Empty(new Layers(File, Layered).Check());

    [Fact]
    public void A_layer_that_uses_one_above_or_beside_it_and_a_namespace_without_a_layer_are_found_with_the_fix()
    {
        var findings = new Layers(File, Crossed).Check().ToList();

        Assert.Equal(
            ["Sample.Crossed.Billing", "Sample.Crossed.Database.Store", "Sample.Crossed.Health.Probe"],
            findings.Select(f => f.Target)
        );
        Assert.StartsWith(
            "the namespace has no layer: add Billing to the layers of Sample.Crossed in Gate/layers.json",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "Database uses Sample.Crossed.Api.ServerApp of Api, which is above it or beside it: move the shared code down",
            findings[1].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith("Health uses Sample.Crossed.Notes.NoteList of Notes", findings[2].Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_project_without_layers_in_the_file_is_not_checked() =>
        Assert.Empty(new Layers(LayersFile.Parse("layers.json", """{ "projects": {} }"""), Crossed).Check());

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() => GuardAssert.HonoursExceptions(new Layers(File, Crossed));
}
