using System.Xml.Linq;

namespace Suwgate.Architecture.Build;

internal sealed class NormalBuilds(IEnumerable<XDocument> documents)
{
    private static readonly Dictionary<string, string[]> Varying = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Configuration"] = ["Debug", "Release"],
        ["CI"] = ["", "true"],
        ["GITHUB_ACTIONS"] = ["", "true"],
    };

    private readonly Dictionary<string, string?> defined = documents
        .SelectMany(document => document.Descendants())
        .Where(element => element.Parent?.Name.LocalName == "PropertyGroup" && Conditions(element).Count == 0)
        .GroupBy(element => element.Name.LocalName, StringComparer.OrdinalIgnoreCase)
        .ToDictionary(
            group => group.Key,
            group =>
                group.Select(element => element.Value.Trim()).Distinct(StringComparer.Ordinal).ToList() is [var value]
                && !value.Contains("$(", StringComparison.Ordinal)
                    ? value
                    : null,
            StringComparer.OrdinalIgnoreCase
        );

    public Applies Applies(XElement element)
    {
        var conditions = Conditions(element);
        if (conditions.Count == 0)
        {
            return Build.Applies.Always;
        }
        if (conditions.Contains(null))
        {
            return Build.Applies.Unknown;
        }
        try
        {
            var outcomes = Environments()
                .Select(environment =>
                    conditions.All(condition => MsBuildCondition.Evaluate(condition ?? "", name => Value(environment, name)))
                )
                .Distinct()
                .ToList();
            return outcomes switch
            {
                [true] => Build.Applies.Always,
                [false] => Build.Applies.Never,
                _ => Build.Applies.Sometimes,
            };
        }
        catch (FormatException)
        {
            return Build.Applies.Unknown;
        }
    }

    private string? Value(Dictionary<string, string> environment, string name) =>
        environment.TryGetValue(name, out var varying) ? varying
        : defined.TryGetValue(name, out var value) ? value
        : "";

    private static List<string?> Conditions(XElement element) =>
        [.. element.AncestorsAndSelf().Select(Condition).Where(condition => condition is null || condition.Length > 0)];

    private static string? Condition(XElement node) =>
        node.Name.LocalName == "Otherwise" ? null : ((string?)node.Attribute("Condition"))?.Trim() ?? "";

    private static IEnumerable<Dictionary<string, string>> Environments() =>
        Varying.Aggregate(
            (IEnumerable<Dictionary<string, string>>)[new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)],
            (environments, varying) =>
                environments.SelectMany(environment =>
                    varying.Value.Select(value => new Dictionary<string, string>(environment, StringComparer.OrdinalIgnoreCase)
                    {
                        [varying.Key] = value,
                    })
                )
        );
}
