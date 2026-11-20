namespace Suwgate.Architecture.Verification;

public interface IGuard
{
    string Id { get; }

    IEnumerable<Finding> Check();
}
