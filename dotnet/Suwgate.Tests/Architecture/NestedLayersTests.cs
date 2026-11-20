using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class NestedLayersTests
{
    private static readonly LayersFile File = LayersFile.Parse(
        "layers.json",
        """
        {
          "projects": {
            "Sample.Nested": { "layers": [".", "Conversation.Turns", "Conversation.State", "Procedures", "Procedures.Steps"] },
            "Sample.Areas": {
              "layers": ["Api", "Orders | Billing", "Shared"],
              "areas": { "Orders": ["Checkout", "Cart | Payment"] }
            },
            "Sample.Subs": { "layers": ["Notes", "Database"], "subFeatures": true }
          }
        }
        """
    );

    private static readonly System.Reflection.Assembly Nested = SampleAssembly.Compile(
        "Sample.Nested",
        """
        namespace Sample.Nested { public static class Bot { public static int Turn() => Sample.Nested.Conversation.Turns.Turn.Take(); } }
        namespace Sample.Nested.Conversation.Turns { public static class Turn { public static int Take() => Sample.Nested.Conversation.State.Facts.Count(); } }
        namespace Sample.Nested.Conversation.State { public static class Facts { public static int Count() => Sample.Nested.Procedures.Run.Steps(); } }
        namespace Sample.Nested.Procedures { public static class Run { public static int Steps() => Sample.Nested.Procedures.Steps.Step.One(); } }
        namespace Sample.Nested.Procedures.Steps { public static class Step { public static int One() => 1; public static int Back() => Sample.Nested.Procedures.Run.Steps() + Sample.Nested.Bot.Turn(); } }
        namespace Sample.Nested.Conversation.Other { public static class Stray { public static int Value => 2; } }
        """
    );

    private static readonly System.Reflection.Assembly Areas = SampleAssembly.Compile(
        "Sample.Areas",
        """
        namespace Sample.Areas.Orders { public static class OrderRoutes { public static int Map() => Sample.Areas.Orders.Checkout.Basket.Pay() + Sample.Areas.Orders.Cart.Lines.Count(); } }
        namespace Sample.Areas.Orders.Checkout { public static class Basket { public static int Pay() => Sample.Areas.Orders.Cart.Lines.Count() + Sample.Areas.Orders.Payment.Card.Charge(); } }
        namespace Sample.Areas.Orders.Cart { public static class Lines { public static int Count() => Sample.Areas.Orders.OrderRoutes.Map() + Sample.Areas.Orders.Payment.Card.Charge(); } }
        namespace Sample.Areas.Orders.Payment { public static class Card { public static int Charge() => Sample.Areas.Shared.Money.Round(); } }
        namespace Sample.Areas.Orders.Returns { public static class Refund { public static int Value => 3; } }
        namespace Sample.Areas.Shared { public static class Money { public static int Round() => 1; } }
        """
    );

    private static readonly System.Reflection.Assembly Subs = SampleAssembly.Compile(
        "Sample.Subs",
        """
        namespace Sample.Subs.Notes { public static class NoteList { public static int Count() => Sample.Subs.Database.Store.Rows() + Sample.Subs.Notes.Sharing.Link.Make(); } }
        namespace Sample.Subs.Notes.Sharing { public static class Link { public static int Make() => Sample.Subs.Notes.NoteList.Count(); } }
        namespace Sample.Subs.Notes.Export { public static class File { public static int Write() => Sample.Subs.Notes.Sharing.Link.Make() + Sample.Subs.Notes.NoteList.Count(); } }
        namespace Sample.Subs.Database { public static class Store { public static int Rows() => 1; } }
        """
    );

    [Fact]
    public void Dotted_parts_and_the_root_namespace_are_layers_a_part_owns_what_no_deeper_part_claims()
    {
        var findings = new Layers(File, Nested).Check().ToList();

        Assert.Equal(
            ["Sample.Nested.Conversation.Other", "Sample.Nested.Procedures.Steps.Step", "Sample.Nested.Procedures.Steps.Step"],
            findings.Select(f => f.Target)
        );
        Assert.StartsWith(
            "the namespace has no layer: add Conversation.Other to the layers of Sample.Nested in layers.json",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "Procedures.Steps uses Sample.Nested.Procedures.Run of Procedures, which is above it or beside it",
            findings[1].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "Procedures.Steps uses Sample.Nested.Bot of the root namespace Sample.Nested, which is above it",
            findings[2].Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void The_features_of_an_area_keep_their_own_order_the_area_root_is_free_and_a_namespace_outside_the_order_is_found()
    {
        var findings = new Layers(File, Areas).Check().ToList();

        Assert.Equal(["Sample.Areas.Orders.Returns", "Sample.Areas.Orders.Cart.Lines"], findings.Select(f => f.Target));
        Assert.StartsWith(
            "the namespace has no layer in its area: add Returns to the area Orders of Sample.Areas in layers.json (\"areas\")",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "Orders.Cart uses Sample.Areas.Orders.Payment.Card of Orders.Payment, which is above it or beside it in their area",
            findings[1].Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void A_sub_feature_used_by_its_feature_or_a_sibling_is_found_and_it_may_use_its_feature()
    {
        var findings = new Layers(File, Subs).Check().ToList();

        Assert.Equal(["Sample.Subs.Notes.Export.File", "Sample.Subs.Notes.NoteList"], findings.Select(f => f.Target));
        Assert.StartsWith(
            "Notes.Export uses Sample.Subs.Notes.Sharing.Link of Notes.Sharing, a sub-feature of Notes: a sub-feature is built on its feature",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith("Notes uses Sample.Subs.Notes.Sharing.Link of Notes.Sharing", findings[1].Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Without_sub_features_on_a_feature_may_use_its_sub_namespaces() =>
        Assert.Empty(
            new Layers(
                LayersFile.Parse("layers.json", """{ "projects": { "Sample.Subs": { "layers": ["Notes", "Database"] } } }"""),
                Subs
            ).Check()
        );

    [Fact]
    public void A_project_whose_assembly_and_root_namespace_differ_from_its_name_is_checked_under_its_root_namespace()
    {
        var cli = SampleAssembly.Compile(
            "suwsample",
            """
            namespace Sample.Cli { public static class Program { public static int Main() => Sample.Cli.Output.Table.Print(); } }
            namespace Sample.Cli.Output { public static class Table { public static int Width => 80; public static int Print() => Sample.Cli.Files.Reader.Read(); } }
            namespace Sample.Cli.Files { public static class Reader { public static int Read() => Sample.Cli.Output.Table.Width; } }
            namespace Sample.Cli.Files { internal static class Forgotten { public static int Value => 1; } }
            """
        );
        using var repository = new TemporaryRepository(
            new Dictionary<string, string>
            {
                ["layers.json"] = """{ "projects": { "Sample.Cli": { "layers": [".", "Output", "Files"] } } }""",
                ["Sample.Cli/Sample.Cli.csproj"] =
                    "<Project><PropertyGroup><RootNamespace>Sample.Cli</RootNamespace><AssemblyName>suwsample</AssemblyName></PropertyGroup></Project>",
            }
        );

        Assert.Equal(
            ["Sample.Cli.Files.Reader"],
            new Layers(LayersFile.Read(repository.Files, "layers.json"), cli).Check().Select(f => f.Target)
        );
        Assert.Equal(
            ["Sample.Cli.Files.Forgotten"],
            new NoUnusedTypes([cli], ["Sample.Cli.Program"], ["Sample.Cli"], []).Check().Select(f => f.Target)
        );
        Assert.Empty(new NoUnusedTypes([cli], ["Sample.Cli.Program"]).Check());
    }

    [Fact]
    public void Without_a_root_namespace_in_the_csproj_it_is_the_project_name_even_when_the_assembly_name_differs()
    {
        using var repository = new TemporaryRepository(
            new Dictionary<string, string>
            {
                ["layers.json"] = """{ "projects": { "Sample.Cli": { "layers": ["Output"] } } }""",
                ["Sample.Cli/Sample.Cli.csproj"] =
                    "<Project><PropertyGroup><AssemblyName>suwsample</AssemblyName></PropertyGroup></Project>",
            }
        );
        var file = LayersFile.Read(repository.Files, "layers.json");

        Assert.Equal("Sample.Cli", file.RootNamespaceOf("Sample.Cli"));
        Assert.Equal("Sample.Missing", file.RootNamespaceOf("Sample.Missing"));
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() => GuardAssert.HonoursExceptions(new Layers(File, Areas, Subs));
}
