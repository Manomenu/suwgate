using Suwgate.Architecture.Design;
using Suwgate.Architecture.Verification;

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

    private static readonly System.Reflection.Assembly WithSdk = SampleAssembly.Compile(
        "Sample.Sdk",
        """
        namespace Sample.Sdk.Payments
        {
            public interface IPaymentGateway { int Charge(int amount); }
            public sealed class StripeGateway : IPaymentGateway { public int Charge(int amount) => amount; }
            public interface IClock { long Now(); }
            public sealed class SystemClock : IClock { public long Now() => 1; }
            public sealed class FixedClock : IClock { public long Now() => 2; }
        }
        """
    );

    [Fact]
    public void An_interface_with_two_implementations_passes() =>
        Assert.Empty(
            new InterfacesHaveTwoImplementations([typeof(Samples.IPaired), typeof(Samples.First), typeof(Samples.Second)]).Check()
        );

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
    public void An_exception_in_suwgate_yml_switches_the_guard_off_for_one_SDK_interface_and_a_stale_one_fails()
    {
        var root = Directory.CreateTempSubdirectory("suwgate-sdk-");
        try
        {
            var file = Path.Combine(root.FullName, "suwgate.yml");
            File.WriteAllText(
                file,
                """
                profiles: [dotnet]
                exceptions:
                  - guard: architecture/interfaces-have-two-implementations
                    target: Sample.Sdk.Payments.IPaymentGateway
                    reason: the payment SDK takes an implementation of this interface; its second one is the SDK's test double
                """
            );
            var guard = InterfacesHaveTwoImplementations.Of(WithSdk);

            Guards.Verify(guard, SuwgateFile.Exceptions(file));

            File.AppendAllText(
                file,
                """

                  - guard: architecture/interfaces-have-two-implementations
                    target: Sample.Sdk.Payments.IClock
                    reason: it had one implementation once
                """
            );
            var failure = Assert.Throws<GuardFailedException>(() => Guards.Verify(guard, SuwgateFile.Exceptions(file)));
            Assert.Contains(
                "architecture/interfaces-have-two-implementations: Sample.Sdk.Payments.IClock: the exception in suwgate.yml matches nothing any more: delete it",
                failure.Message,
                StringComparison.Ordinal
            );
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails() =>
        GuardAssert.HonoursExceptions(new InterfacesHaveTwoImplementations(Types));
}
