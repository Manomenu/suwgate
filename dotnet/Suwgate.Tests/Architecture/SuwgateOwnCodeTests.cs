using Suwgate.Architecture.Profiles;
using Suwgate.Architecture.Verification;
using Suwgate.Database.Migrations;

namespace Suwgate.Tests.Architecture;

public sealed class SuwgateOwnCodeTests
{
    [Fact]
    public void Every_guard_of_its_profiles_passes_on_its_own_code() =>
        SuwgateGuards.VerifyAll(new GuardInputs { Production = [typeof(IGuard).Assembly, typeof(MigrationScriptNames).Assembly] });
}
