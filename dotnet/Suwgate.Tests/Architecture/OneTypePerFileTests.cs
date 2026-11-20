using Suwgate.Architecture.Code;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class OneTypePerFileTests
{
    private static List<string> MessagesFor(string path, string text) =>
        [.. new OneTypePerFile([new SourceFile(path, text)]).Check().Select(f => f.Message)];

    [Theory]
    [InlineData("App/Note.cs", "namespace App; public sealed class Note { private sealed class Inner { } }")]
    [InlineData("App/Kind.cs", "namespace App { public enum Kind { A } }")]
    [InlineData("App/Handler.cs", "namespace App; public delegate void Handler();")]
    [InlineData("App/Program.cs", "var x = 1;")]
    public void One_top_level_type_named_like_the_file_passes(string path, string text) => Assert.Empty(MessagesFor(path, text));

    [Fact]
    public void Two_top_level_types_are_found_with_the_fix() =>
        Assert.Equal(
            ["2 top-level types (Note, Tag): move each into a file of its own"],
            MessagesFor("App/Note.cs", "namespace App; public sealed class Note { } public sealed record Tag(string Name);")
        );

    [Fact]
    public void A_type_named_unlike_its_file_is_found_with_the_fix() =>
        Assert.Equal(
            ["it holds Tag: rename the file to Tag.cs, or the type to Note"],
            MessagesFor("App/Note.cs", "namespace App; public interface Tag { }")
        );

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new OneTypePerFile([new SourceFile("App/Note.cs", "namespace App; class A { } class B { }")]));
}
