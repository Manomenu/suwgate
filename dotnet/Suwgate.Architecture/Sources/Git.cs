using System.Diagnostics;

namespace Suwgate.Architecture.Sources;

internal static class Git
{
    private static readonly string[] RepositoryVariables =
    [
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
        "GIT_OBJECT_DIRECTORY",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_IMPLICIT_WORK_TREE",
        "GIT_GRAFT_FILE",
        "GIT_INDEX_FILE",
        "GIT_NO_REPLACE_OBJECTS",
        "GIT_REPLACE_REF_BASE",
        "GIT_PREFIX",
        "GIT_SHALLOW_FILE",
        "GIT_COMMON_DIR",
    ];

    public static GitResult Run(string directory, params string[] arguments)
    {
        var start = new ProcessStartInfo("git")
        {
            WorkingDirectory = directory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }
        OfTheDirectoryOnly(start.Environment);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("git did not start: install git");
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        return new GitResult(process.ExitCode, output, error);
    }

    internal static void OfTheDirectoryOnly(IDictionary<string, string?> environment)
    {
        foreach (var variable in RepositoryVariables)
        {
            environment.Remove(variable);
        }
    }
}
