using Suwgate.Architecture.Code;

namespace Suwgate.Tests.Architecture;

public sealed class ForbiddenTypeNamesTests
{
    private static readonly System.Reflection.Assembly Names = SampleAssembly.Compile(
        "Sample.Names",
        """
        namespace Sample.Names.Utils { public static class StringHelper { } }
        namespace Sample.Names.Notes { public sealed class Note { } public sealed class NoteRepository { } public sealed class Scoreboard { } }
        """
    );

    [Theory]
    [InlineData("StringHelpers", "Helpers")]
    [InlineData("Utils", "Utils")]
    [InlineData("OutputManager", "Manager")]
    [InlineData("Dtos", "DTOs")]
    [InlineData("Base", "Base")]
    [InlineData("Database", null)]
    [InlineData("Notes", null)]
    [InlineData("Scoreboard", null)]
    public void A_forbidden_word_is_found_by_its_words_not_by_letters(string name, string? expected) =>
        Assert.Equal(
            expected,
            ForbiddenTypeNames.ForbiddenIn(name, [.. ForbiddenTypeNames.Vague, .. ForbiddenTypeNames.LayerByKind, "Base"])
        );

    [Fact]
    public void Types_named_after_what_they_are_in_feature_namespaces_pass() =>
        Assert.Empty(new ForbiddenTypeNames(SampleTypes("Sample.Names.Notes.Note", "Sample.Names.Notes.Scoreboard")).Check());

    [Fact]
    public void A_forbidden_namespace_segment_a_vague_type_name_and_a_forbidden_suffix_are_found_with_the_fix()
    {
        var findings = ForbiddenTypeNames.Of(Names).Check().ToList();

        Assert.Equal(
            ["Sample.Names.Utils", "Sample.Names.Notes.NoteRepository", "Sample.Names.Utils.StringHelper"],
            findings.Select(f => f.Target)
        );
        Assert.StartsWith(
            "the namespace segment Utils is a forbidden word (Utils): name it after the feature",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "the type name holds a forbidden word (Repository): name it after the feature",
            findings[1].Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() => GuardAssert.HonoursExceptions(ForbiddenTypeNames.Of(Names));

    private static Type[] SampleTypes(params string[] names) =>
        [.. names.Select(name => Names.DefinedTypes.Single(type => type.FullName == name).AsType())];
}
