using System.Reflection;

namespace Suwgate.Architecture.Profiles;

public sealed class GuardInputs
{
    public required IReadOnlyList<Assembly> Production { get; init; }

    public IReadOnlyList<Assembly> Tests { get; init; } = [];

    public Type? Server { get; init; }

    public IReadOnlyList<string> EntryPoints { get; init; } = [];

    public string FixtureField { get; init; } = "TestApp";

    public string ClassFixture { get; init; } = "ClassServer";
}
