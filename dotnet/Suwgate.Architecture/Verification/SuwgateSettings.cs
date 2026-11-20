namespace Suwgate.Architecture.Verification;

public sealed record SuwgateSettings(
    string Path,
    IReadOnlyList<string> Profiles,
    IReadOnlyList<ExceptionEntry> Exceptions,
    IReadOnlyList<GuardSkip> Skipped,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Settings
)
{
    public bool Skips(string guard) => Skipped.Any(skip => skip.Guard == guard);

    public string? Setting(string guard, string key) =>
        Settings.TryGetValue(guard, out var values) && values.TryGetValue(key, out var value) ? value : null;
}
