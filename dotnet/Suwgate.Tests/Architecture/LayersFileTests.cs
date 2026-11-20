using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class LayersFileTests
{
    [Fact]
    public void Each_project_gets_its_layers_split_into_levels_and_absent_lists_are_empty()
    {
        var file = LayersFile.Parse(
            "layers.json",
            """{ "projects": { "App.Server": { "layers": ["Api", "Notes | Health", "Database"] }, "App.Gate": { "references": ["App.Server"] } } }"""
        );

        Assert.Equal(
            [
                ["Api"],
                ["Notes", "Health"],
                ["Database"],
            ],
            file.LevelsOf("App.Server")
        );
        Assert.Equal(["App.Server"], file.Projects["App.Gate"].References);
        Assert.Empty(file.Projects["App.Gate"].InternalsVisibleTo);
        Assert.Empty(file.LevelsOf("App.Unknown"));
    }

    [Theory]
    [InlineData("""{ "serverLayers": [] }""", "layers.json: it has no \"projects\" object")]
    [InlineData("""{ "projects": { "App": { "layers": "Api" } } }""", "layers.json: \"layers\" of App is not an array of strings")]
    public void A_malformed_file_is_refused_with_what_to_change(string json, string message) =>
        Assert.StartsWith(
            message,
            Assert.Throws<InvalidDataException>(() => LayersFile.Parse("layers.json", json)).Message,
            StringComparison.Ordinal
        );
}
