namespace Suwgate.Architecture.Verification;

public sealed class GuardFailedException : Exception
{
    public GuardFailedException() { }

    public GuardFailedException(string message)
        : base(message) { }

    public GuardFailedException(string message, Exception innerException)
        : base(message, innerException) { }
}
