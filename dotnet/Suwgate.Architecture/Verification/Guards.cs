namespace Suwgate.Architecture.Verification;

public static class Guards
{
    public static void Verify(IGuard guard) => Verify(guard, SuwgateFile.Exceptions());

    public static void Verify(IGuard guard, IReadOnlyList<ExceptionEntry> exceptions)
    {
        ArgumentNullException.ThrowIfNull(guard);
        ArgumentNullException.ThrowIfNull(exceptions);
        var own = exceptions.Where(exception => exception.Guard == guard.Id).ToList();
        var findings = guard.Check().ToList();
        var problems = findings
            .Where(finding => !own.Any(exception => exception.Target == finding.Target))
            .Select(finding => $"{guard.Id}: {finding.Target}: {finding.Message}")
            .Concat(
                own.Where(exception => !findings.Any(finding => finding.Target == exception.Target))
                    .Select(exception =>
                        $"{guard.Id}: {exception.Target}: the exception in {SuwgateFile.Name} matches nothing any more: delete it"
                    )
            )
            .ToList();
        if (problems.Count > 0)
        {
            throw new GuardFailedException(
                $"{problems.Count} problem(s); fix the code, or add an exception with its reason to {SuwgateFile.Name}:{Environment.NewLine}"
                    + string.Join(Environment.NewLine, problems)
            );
        }
    }
}
