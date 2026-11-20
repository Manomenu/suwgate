using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Profiles;

public sealed record ProfileContext(RepositoryFiles Repository, SuwgateSettings Settings, GuardInputs Inputs);
