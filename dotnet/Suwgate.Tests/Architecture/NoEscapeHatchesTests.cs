using Suwgate.Architecture.Code;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class NoEscapeHatchesTests
{
    private static List<string> MessagesFor(string text) =>
        [.. new NoEscapeHatches([new SourceFile("App/Note.cs", text)]).Check().Select(f => f.Message)];

    [Theory]
    [InlineData("class Note { bool Ok(bool a) => !a; int Dynamic() => 1; string Text => \"dynamic!\"; }")]
    [InlineData("class Note { string? Name; int Length => Name is null ? 0 : Name.Length; }")]
    public void Typed_null_checked_code_passes(string text) => Assert.Empty(MessagesFor(text));

    [Fact]
    public void Dynamic_is_found_with_the_line_and_the_fix() =>
        Assert.Equal(
            ["line 2: `dynamic` switches the compiler off: give it a real type (a record, a generic)"],
            MessagesFor("class Note {\n  dynamic Value;\n}")
        );

    [Fact]
    public void The_null_forgiving_operator_is_found_with_the_line_and_the_fix() =>
        Assert.Equal(
            ["line 1: remove the null-forgiving `!`: check for null and say what happens then, or fix the type so that it cannot be null"],
            MessagesFor("class Note { string? Name; int Length => Name!.Length; }")
        );

    [Fact]
    public void With_the_setting_for_tests_the_null_forgiving_operator_is_allowed_in_test_projects_only()
    {
        const string text = "class Note { string? Name; dynamic Value; int Length => Name!.Length; }";
        var findings = new NoEscapeHatches(
            [new SourceFile("App/Note.cs", text), new SourceFile("App.Tests/NoteTests.cs", text)],
            nullForgivingInTests: true
        )
            .Check()
            .Select(f => $"{f.Target} {f.Message.Split(':')[1].Trim()}")
            .ToList();

        Assert.Equal(
            [
                "App.Tests/NoteTests.cs `dynamic` switches the compiler off",
                "App/Note.cs `dynamic` switches the compiler off",
                "App/Note.cs remove the null-forgiving `!`",
            ],
            findings
        );
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new NoEscapeHatches([new SourceFile("App/Note.cs", "class Note { dynamic Value; }")]));
}
