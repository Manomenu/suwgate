namespace Suwgate.Architecture.Verification;

public sealed class Evidence(string? directory)
{
    public const string Variable = "SUWGATE_EVIDENCE";

    private static readonly Lock Writing = new();

    private readonly string file = $"guards-{Environment.ProcessId}.tsv";

    public static Evidence FromEnvironment() => new(Environment.GetEnvironmentVariable(Variable));

    public void Record(string guard, bool passed)
    {
        if (string.IsNullOrEmpty(directory))
        {
            return;
        }
        lock (Writing)
        {
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, file), $"{guard}\t{(passed ? "passed" : "failed")}\n");
        }
    }
}
