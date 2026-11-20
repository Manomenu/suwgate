using System.Xml.Linq;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Build;

public sealed class BuildSettings(RepositoryFiles repository) : IGuard
{
    public const string GuardId = "architecture/build-settings";

    public const string RootProps = "Directory.Build.props";

    private static readonly Dictionary<string, string> Defaults = new(StringComparer.Ordinal)
    {
        ["TreatWarningsAsErrors"] = "true",
        ["Nullable"] = "enable",
        ["AnalysisLevel"] = "latest-all",
        ["AnalysisMode"] = "All",
        ["EnforceCodeStyleInBuild"] = "true",
        ["GenerateDocumentationFile"] = "true",
        ["RunAnalyzers"] = "true",
        ["RunAnalyzersDuringBuild"] = "true",
        ["EnableNETAnalyzers"] = "true",
        ["CodeAnalysisTreatWarningsAsErrors"] = "true",
        ["RestorePackagesWithLockFile"] = "true",
    };

    private static readonly string[] Switches = ["NoWarn", "WarningsNotAsErrors"];

    private static readonly Dictionary<string, string> RestoreSettings = new(StringComparer.Ordinal)
    {
        ["TreatWarningsAsErrors"] =
            "NuGet audit only warns: add <TreatWarningsAsErrors>true</TreatWarningsAsErrors>, so that a vulnerable package fails the restore",
        ["RestorePackagesWithLockFile"] =
            "lock files are off: add <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile> "
            + "(and <RestoreLockedMode Condition=\"'$(CI)' != ''\">true</RestoreLockedMode>)",
    };

    public string Id => GuardId;

    public IEnumerable<Finding> Check()
    {
        ArgumentNullException.ThrowIfNull(repository);
        var files = repository
            .Paths.Where(path =>
                path.EndsWith(".csproj", StringComparison.Ordinal)
                || path.EndsWith(".props", StringComparison.Ordinal)
                || path.EndsWith(".targets", StringComparison.Ordinal)
            )
            .Where(path => !path.Contains("/obj/", StringComparison.Ordinal) && !path.Contains("/bin/", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToList();
        return [.. RootFindings(), .. files.SelectMany(file => PropertyFindings(file, XDocument.Parse(repository.Read(file))))];
    }

    private IEnumerable<Finding> RootFindings()
    {
        if (!repository.Paths.Contains(RootProps))
        {
            yield return new Finding(
                RootProps,
                $"missing: add {RootProps} with the target framework, warnings as errors, the lock files and the Suwgate.Architecture reference"
            );
            yield break;
        }
        var props = XDocument.Parse(repository.Read(RootProps));
        foreach (var (property, fix) in RestoreSettings.Where(setting => !Sets(props, setting.Key)))
        {
            yield return new Finding(
                $"{RootProps}: {property}",
                $"{fix}; restore reads it before any package's props, so Suwgate.Architecture cannot set it"
            );
        }
        if (!props.ToString().Contains("Suwgate.Architecture", StringComparison.Ordinal))
        {
            yield return new Finding(
                $"{RootProps}: Suwgate.Architecture",
                "the build defaults do not reach every project: add <PackageReference Include=\"Suwgate.Architecture\" PrivateAssets=\"all\" IncludeAssets=\"build;buildTransitive;analyzers\" /> to an ItemGroup"
            );
        }
    }

    private static bool Sets(XDocument props, string property) =>
        props.Descendants().Any(element => element.Name.LocalName == property && element.Value.Trim() == "true");

    private static IEnumerable<Finding> PropertyFindings(string file, XDocument document) =>
        document
            .Descendants()
            .Where(element => element.Parent?.Name.LocalName == "PropertyGroup")
            .Select(element => (name: element.Name.LocalName, value: element.Value.Trim()))
            .Select(property => (property.name, fix: FixOf(property.name, property.value)))
            .Where(property => property.fix is not null)
            .Select(property => new Finding($"{file}: {property.name}", property.fix ?? ""));

    private static string? FixOf(string name, string value)
    {
        if (Switches.Contains(name))
        {
            return $"{name} switches diagnostics off for the whole project: delete it and fix what the build reports, or set one rule's severity in .editorconfig and say why in the docs";
        }
        return Defaults.TryGetValue(name, out var expected) && !string.Equals(value, expected, StringComparison.OrdinalIgnoreCase)
            ? $"it is {value}, the default is {expected}: delete the line (Suwgate.Architecture sets it) and fix what the build reports"
            : null;
    }
}
