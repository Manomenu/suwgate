using Suwgate.Architecture.Design;

namespace Suwgate.Tests.Architecture;

public sealed class NothingObsoleteTests
{
    private static readonly System.Reflection.Assembly Obsolete = SampleAssembly.Compile(
        "Sample.Obsolete",
        """
        namespace Sample.Obsolete
        {
            [System.Obsolete("use New")] public sealed class Old { }
            public sealed class Kept { [System.Obsolete] public int Before() => 1; public int After() => 2; }
            public sealed class WithRequired { public required int Value { get; init; } }
        }
        """
    );

    private static readonly System.Reflection.Assembly Current = SampleAssembly.Compile(
        "Sample.Current",
        "namespace Sample.Current { public sealed class WithRequired { public required int Value { get; init; } } }"
    );

    [Fact]
    public void Nothing_obsolete_passes_even_with_required_members() => Assert.Empty(new NothingObsolete(Current).Check());

    [Fact]
    public void An_obsolete_type_or_member_is_found_with_the_fix()
    {
        var findings = new NothingObsolete(Obsolete).Check().ToList();

        Assert.Equal(["Sample.Obsolete.Kept.Before", "Sample.Obsolete.Old"], findings.Select(f => f.Target));
        Assert.Equal("it is marked [Obsolete]: migrate the callers and delete it in this change, no shims", findings[0].Message);
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() => GuardAssert.HonoursExceptions(new NothingObsolete(Obsolete));
}
