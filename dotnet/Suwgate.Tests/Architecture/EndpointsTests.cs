using Suwgate.Architecture.Design;

namespace Suwgate.Tests.Architecture;

public sealed class EndpointsTests
{
    private static readonly System.Reflection.Assembly Routes = SampleAssembly.Compile(
        "Sample.Routes",
        """
        namespace Sample.Routes.Api { public static class ServerApp { public static int Map() => Sample.Routes.Notes.NotesEndpoints.Map() + Sample.Routes.Tags.TagsEndpoints.Map(); } }
        namespace Sample.Routes.Notes { public static class NotesEndpoints { public static int Map() => 1; } }
        namespace Sample.Routes.Tags { public static class TagsEndpoints { public static int Map() => 2; } }
        """
    );

    private static readonly System.Reflection.Assembly Scattered = SampleAssembly.Compile(
        "Sample.Scattered",
        """
        namespace Sample.Scattered.Api { public static class ServerApp { public static int Map() => Sample.Scattered.Notes.NotesEndpoints.Map() + Sample.Scattered.Notes.TagsEndpoints.Map(); } }
        namespace Sample.Scattered.Notes { public static class NotesEndpoints { public static int Map() => 1; } }
        namespace Sample.Scattered.Notes { public static class TagsEndpoints { public static int Map() => 2; } }
        namespace Sample.Scattered.Health { public static class HealthEndpoints { public static int Map() => 3; } }
        """
    );

    [Fact]
    public void Endpoints_mapped_from_the_mapping_namespace_one_per_namespace_pass() =>
        Assert.Empty(new Endpoints(Routes, "Sample.Routes.Api", "Endpoints").Check());

    [Fact]
    public void An_unmapped_endpoints_class_and_a_second_one_in_a_namespace_are_found_with_the_fix()
    {
        var findings = new Endpoints(Scattered, "Sample.Scattered.Api", "Endpoints").Check().ToList();

        Assert.Equal(["Sample.Scattered.Health.HealthEndpoints", "Sample.Scattered.Notes"], findings.Select(f => f.Target));
        Assert.StartsWith(
            "nothing in Sample.Scattered.Api maps it: call its Map method from there",
            findings[0].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "2 *Endpoints classes (NotesEndpoints, TagsEndpoints): a second set of routes is a second feature",
            findings[1].Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new Endpoints(Scattered, "Sample.Scattered.Api", "Endpoints"));
}
