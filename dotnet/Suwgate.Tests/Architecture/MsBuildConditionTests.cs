using Suwgate.Architecture.Build;

namespace Suwgate.Tests.Architecture;

public sealed class MsBuildConditionTests
{
    private static string? Property(string name) =>
        name switch
        {
            "Configuration" => "Debug",
            "Unknown" => null,
            _ => "",
        };

    [Theory]
    [InlineData("'$(Configuration)' == 'debug'", true)]
    [InlineData("'$(SdkPath)' != ''", false)]
    [InlineData("'$(SdkPath)' == '' and '$(Configuration)' == 'Release'", false)]
    [InlineData("'$(SdkPath)' == '' Or '$(Configuration)' == 'Release'", true)]
    [InlineData("!('$(Configuration)' == 'Release')", true)]
    [InlineData("$(Configuration) == Debug", true)]
    [InlineData("'10' >= '9'", true)]
    [InlineData("true", true)]
    [InlineData("!false and '$(SdkPath)' == ''", true)]
    public void A_condition_is_evaluated_as_MSBuild_does(string condition, bool expected) =>
        Assert.Equal(expected, MsBuildCondition.Evaluate(condition, Property));

    [Theory]
    [InlineData("Exists('local.props')")]
    [InlineData("'$(Configuration.ToLower())' == 'debug'")]
    [InlineData("'$(Unknown)' == ''")]
    [InlineData("'@(Items)' != ''")]
    [InlineData("'$(Configuration)' ==")]
    [InlineData("'a' == 'a' 'b'")]
    public void A_condition_it_cannot_evaluate_is_refused(string condition) =>
        Assert.Throws<FormatException>(() => MsBuildCondition.Evaluate(condition, Property));
}
