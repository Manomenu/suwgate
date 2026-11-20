namespace Suwgate.Architecture.Sources;

internal sealed record GitResult(int ExitCode, string Output, string Error)
{
    public bool Succeeded => ExitCode == 0;
}
