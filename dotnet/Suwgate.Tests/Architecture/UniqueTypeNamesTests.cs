using Suwgate.Architecture.Code;

namespace Suwgate.Tests.Architecture;

public sealed class UniqueTypeNamesTests
{
    private static readonly System.Reflection.Assembly Clashes = SampleAssembly.Compile(
        "Sample.Clashes",
        """
        namespace Sample.Clashes.Notes { public sealed class Note { } public sealed class Box<T> { } }
        namespace Sample.Clashes.Archive { public sealed class Note { } public sealed class Box { } public sealed class Shelf { } }
        """
    );

    private static readonly System.Reflection.Assembly Distinct = SampleAssembly.Compile(
        "Sample.Distinct",
        "namespace Sample.Distinct { public sealed class Note { } public sealed class Shelf { } }"
    );

    [Fact]
    public void Types_with_distinct_names_pass() => Assert.Empty(UniqueTypeNames.Of(Distinct).Check());

    [Fact]
    public void Two_types_with_one_simple_name_are_found_with_the_fix_generic_or_not()
    {
        var findings = UniqueTypeNames.Of(Clashes).Check().ToList();

        Assert.Equal(["Box", "Note"], findings.Select(f => f.Target));
        Assert.Equal(
            "2 types share the name (Sample.Clashes.Archive.Note, Sample.Clashes.Notes.Note): rename all but one, so that grep for the name finds exactly one definition",
            findings[1].Message
        );
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() => GuardAssert.HonoursExceptions(UniqueTypeNames.Of(Clashes));
}
