using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;

namespace Suwgate.Tests.Architecture;

public sealed class NoUnusedTypesTests
{
    private static readonly System.Reflection.Assembly Unused = SampleAssembly.Compile(
        "Sample.Unused",
        """
        namespace Sample.Unused
        {
            public static class Entry { public static int Run() => Used.Value + Outer.Total(); }
            internal static class Used { public static int Value => 1; }
            internal static class Forgotten { public static int Value => 2; }
            internal static class Program { public static int Main() => 0; }
            internal static class Outer
            {
                public static int Total() => Inner.Value;
                private static class Inner { public static int Value => 3; }
            }
            internal static class Lonely { private static class OnlyMine { public static int Value => Lonely.Read(); } private static int Read() => 4; }
        }
        """
    );

    [Fact]
    public void A_non_public_type_no_other_type_uses_is_found_with_the_fix_its_own_nested_types_do_not_count_and_entry_points_are_skipped()
    {
        var findings = new NoUnusedTypes([Unused], ["Sample.Unused.Program"]).Check().ToList();

        Assert.Equal(["Sample.Unused.Forgotten", "Sample.Unused.Lonely", "Sample.Unused.Lonely+OnlyMine"], findings.Select(f => f.Target));
        Assert.StartsWith("no other type uses this non-public type: delete it", findings[0].Message, StringComparison.Ordinal);
    }

    private const string Inlined = """
        namespace Sample.Inlined
        {
            [System.AttributeUsage(System.AttributeTargets.All)]
            public sealed class PatternAttribute : System.Attribute
            {
                public PatternAttribute(string pattern) { }
                public PatternAttribute(int length) { }
                public System.Type? Kind { get; set; }
            }
            public static class Entry
            {
                [Pattern(CamelCase.Pattern)]
                public static int Run([Pattern(Limits.Name)] int value) => value > Limits.Turns ? 1 : 0;
                [Pattern("x", Kind = typeof(Marker))]
                public static int Mark() => 0;
                public static System.Func<System.Threading.Tasks.Task<int>> Later() => async () => { await System.Threading.Tasks.Task.Yield(); return Awaited.Value(); };
            }
            internal static class CamelCase { public const string Pattern = "^[a-z]+(?:[A-Z][a-z]*)*$"; }
            internal static class Limits { public const int Name = 40; public const int Turns = 3; }
            internal sealed class Marker { }
            internal static class Awaited { public static int Value() => 1; }
            internal static class SelfNamed { public const string Value = "self"; [Pattern(Value)] public static int Read() => SelfNamed.Value.Length; }
            internal static class Forgotten { public const string Value = "never named"; }
        }
        """;

    [Fact]
    public void A_type_named_only_where_compiled_code_loses_it_counts_as_used_an_attribute_argument_an_inlined_constant_an_async_lambda()
    {
        var inlined = SampleAssembly.Compile("Sample.Inlined", Inlined);

        Assert.Equal(
            ["Sample.Inlined.Forgotten", "Sample.Inlined.SelfNamed"],
            new NoUnusedTypes([inlined], [], ["Sample.Inlined"], [new SourceFile("Sample.Inlined/Entry.cs", Inlined)])
                .Check()
                .Select(f => f.Target)
        );
        Assert.Equal(
            [
                "Sample.Inlined.CamelCase",
                "Sample.Inlined.Forgotten",
                "Sample.Inlined.Limits",
                "Sample.Inlined.Marker",
                "Sample.Inlined.SelfNamed",
            ],
            new NoUnusedTypes([inlined], []).Check().Select(f => f.Target)
        );
    }

    [Fact]
    public void An_entry_point_is_found_when_it_is_not_passed() =>
        Assert.Contains("Sample.Unused.Program", new NoUnusedTypes([Unused], []).Check().Select(f => f.Target));

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new NoUnusedTypes([Unused], ["Sample.Unused.Program"]));
}
