namespace Suwgate.Architecture.Profiles;

public interface IGuardProfile
{
    string Name { get; }

    IReadOnlyList<PlannedGuard> Guards(ProfileContext context);
}
