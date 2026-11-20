using Suwgate.Architecture.Verification;

namespace Suwgate.Tests.Architecture;

internal static class GuardAssert
{
    public static void HonoursExceptions(IGuard guard)
    {
        var excepted = guard
            .Check()
            .Select(finding => finding.Target)
            .Distinct(StringComparer.Ordinal)
            .Select(target => new ExceptionEntry(guard.Id, target, "a reason the owner wrote"))
            .ToList();
        Assert.NotEmpty(excepted);

        Guards.Verify(guard, excepted);

        var failure = Assert.Throws<GuardFailedException>(() =>
            Guards.Verify(guard, [.. excepted, new ExceptionEntry(guard.Id, "Gone.Target", "it was needed once")])
        );
        Assert.Contains(
            $"{guard.Id}: Gone.Target: the exception in suwgate.yml matches nothing any more: delete it",
            failure.Message,
            StringComparison.Ordinal
        );
    }
}
