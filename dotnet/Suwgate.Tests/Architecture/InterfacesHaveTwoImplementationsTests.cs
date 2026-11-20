using Suwgate.Architecture.Design;
using Suwgate.Architecture.Verification;
using Suwgate.Database.Migrations;

namespace Suwgate.Tests.Architecture;

public sealed class InterfacesHaveTwoImplementationsTests
{
    private static readonly Type[] Types =
    [
        typeof(Samples.ILonely),
        typeof(Samples.IPaired),
        typeof(Samples.OnlyOne),
        typeof(Samples.First),
        typeof(Samples.Second),
    ];

    [Fact]
    public void An_interface_with_one_implementation_is_found_with_the_fix()
    {
        var findings = new InterfacesHaveTwoImplementations(Types).Check().ToList();

        var finding = Assert.Single(findings);
        Assert.Equal(typeof(Samples.ILonely).FullName, finding.Target);
        Assert.StartsWith("1 implementation(s): delete the interface and use the class", finding.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void An_exception_with_its_reason_lets_one_interface_through()
    {
        var exceptions = new[]
        {
            new ExceptionEntry(InterfacesHaveTwoImplementations.GuardId, typeof(Samples.ILonely).FullName ?? "", "an SDK asks for it"),
        };

        Guards.Verify(new InterfacesHaveTwoImplementations(Types), exceptions);
    }

    [Fact]
    public void Suwgate_s_own_guards_pass_it_with_the_exceptions_of_its_suwgate_yml() =>
        Guards.Verify(InterfacesHaveTwoImplementations.Of(typeof(IGuard).Assembly, typeof(MigrationScriptNames).Assembly));
}
