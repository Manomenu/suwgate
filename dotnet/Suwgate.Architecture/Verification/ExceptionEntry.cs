namespace Suwgate.Architecture.Verification;

public sealed record ExceptionEntry(string Guard, string Target, string Reason, string? Message = null, bool Once = false)
{
    public bool Matches(Finding finding)
    {
        ArgumentNullException.ThrowIfNull(finding);
        return finding.Target == Target && (Message is null || finding.Message.Contains(Message, StringComparison.Ordinal));
    }

    public bool Same(ExceptionEntry other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return other.Guard == Guard && other.Target == Target && other.Message == Message;
    }
}
