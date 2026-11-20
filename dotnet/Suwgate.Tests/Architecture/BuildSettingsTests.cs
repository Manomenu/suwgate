using Suwgate.Architecture.Build;

namespace Suwgate.Tests.Architecture;

public sealed class BuildSettingsTests
{
    private const string ThinProps = """
        <Project>
          <PropertyGroup>
            <TargetFramework>net10.0</TargetFramework>
            <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
            <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
          </PropertyGroup>
          <ItemGroup>
            <PackageReference Include="Suwgate.Architecture" PrivateAssets="all" IncludeAssets="build;buildTransitive;analyzers" />
          </ItemGroup>
        </Project>
        """;

    private static List<(string Target, string Message)> FindingsFor(Dictionary<string, string> files)
    {
        using var repository = new TemporaryRepository(files);
        return [.. new BuildSettings(repository.Files).Check().Select(f => (f.Target, f.Message))];
    }

    [Fact]
    public void A_thin_props_with_the_lock_files_and_the_package_and_projects_that_keep_the_defaults_pass() =>
        Assert.Empty(
            FindingsFor(
                new()
                {
                    ["Directory.Build.props"] = ThinProps,
                    ["App/App.csproj"] =
                        """<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><Nullable>enable</Nullable><OutputType>Exe</OutputType></PropertyGroup></Project>""",
                }
            )
        );

    [Fact]
    public void A_project_that_turns_a_default_off_or_silences_diagnostics_is_found_with_the_fix()
    {
        var findings = FindingsFor(
            new()
            {
                ["Directory.Build.props"] = ThinProps,
                ["App/App.csproj"] = """
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup>
                    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
                    <Nullable>disable</Nullable>
                    <AnalysisLevel>latest-recommended</AnalysisLevel>
                    <NoWarn>$(NoWarn);CA1062</NoWarn>
                  </PropertyGroup>
                </Project>
                """,
            }
        );

        Assert.Equal(
            [
                "App/App.csproj: TreatWarningsAsErrors",
                "App/App.csproj: Nullable",
                "App/App.csproj: AnalysisLevel",
                "App/App.csproj: NoWarn",
            ],
            findings.Select(f => f.Target)
        );
        Assert.Equal(
            "it is false, the default is true: delete the line (Suwgate.Architecture sets it) and fix what the build reports",
            findings[0].Message
        );
        Assert.StartsWith(
            "NoWarn switches diagnostics off for the whole project: delete it",
            findings[3].Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void A_root_props_without_the_restore_settings_or_the_package_is_found_with_the_fix()
    {
        var findings = FindingsFor(
            new()
            {
                ["Directory.Build.props"] = "<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>",
            }
        );

        Assert.Equal(
            [
                "Directory.Build.props: TreatWarningsAsErrors",
                "Directory.Build.props: RestorePackagesWithLockFile",
                "Directory.Build.props: Suwgate.Architecture",
            ],
            findings.Select(f => f.Target)
        );
        Assert.Equal(
            "NuGet audit only warns: add <TreatWarningsAsErrors>true</TreatWarningsAsErrors>, so that a vulnerable package fails the restore; "
                + "restore reads it before any package's props, so Suwgate.Architecture cannot set it",
            findings[0].Message
        );
        Assert.StartsWith(
            "lock files are off: add <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>",
            findings[1].Message,
            StringComparison.Ordinal
        );
        Assert.StartsWith(
            "the build defaults do not reach every project: add <PackageReference Include=\"Suwgate.Architecture\"",
            findings[2].Message,
            StringComparison.Ordinal
        );
    }

    [Fact]
    public void A_missing_root_props_is_found_with_the_fix() =>
        Assert.Equal(
            [
                (
                    "Directory.Build.props",
                    "missing: add Directory.Build.props with the target framework, warnings as errors, the lock files and the Suwgate.Architecture reference"
                ),
            ],
            FindingsFor(new() { ["App/App.csproj"] = "<Project />" })
        );

    [Fact]
    public void Every_finding_can_be_excepted_and_a_stale_exception_fails()
    {
        using var repository = new TemporaryRepository(new Dictionary<string, string> { ["Directory.Build.props"] = "<Project />" });

        GuardAssert.HonoursExceptions(new BuildSettings(repository.Files));
    }
}
