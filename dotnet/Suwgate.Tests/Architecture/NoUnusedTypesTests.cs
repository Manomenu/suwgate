using Suwgate.Architecture.Design;

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

    [Fact]
    public void An_entry_point_is_found_when_it_is_not_passed() =>
        Assert.Contains("Sample.Unused.Program", new NoUnusedTypes([Unused], []).Check().Select(f => f.Target));

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new NoUnusedTypes([Unused], ["Sample.Unused.Program"]));
}
