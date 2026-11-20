using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Profiles;

public sealed record PlannedGuard(string Id, Func<IGuard> Create);
