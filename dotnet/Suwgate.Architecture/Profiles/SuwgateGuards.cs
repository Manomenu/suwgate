using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Profiles;

public static class SuwgateGuards
{
    public const string DatabaseProfile = "database";

    public static void VerifyAll(GuardInputs inputs, params IGuardProfile[] profiles)
    {
        var path = SuwgateFile.Find(AppContext.BaseDirectory);
        var root = Path.GetDirectoryName(path) ?? throw new InvalidOperationException($"{SuwgateFile.Name} has no directory");
        Verify(inputs, profiles, SuwgateFile.Read(path), RepositoryFiles.Of(root), Evidence.FromEnvironment());
    }

    internal static void Verify(
        GuardInputs inputs,
        IReadOnlyList<IGuardProfile> profiles,
        SuwgateSettings settings,
        RepositoryFiles repository,
        Evidence evidence
    )
    {
        ArgumentNullException.ThrowIfNull(inputs);
        ArgumentNullException.ThrowIfNull(profiles);
        ArgumentNullException.ThrowIfNull(settings);
        IReadOnlyList<IGuardProfile> all = [new DotnetProfile(), .. profiles];
        var context = new ProfileContext(repository, settings, inputs);
        List<string> problems =
        [
            .. profiles
                .Where(profile => !settings.Profiles.Contains(profile.Name))
                .Select(profile =>
                    $"{profile.Name}: {settings.Path} has no {profile.Name} profile: add it to profiles, or stop passing {profile.GetType().Name} to VerifyAll"
                ),
            .. settings
                .Profiles.Where(name => name == DatabaseProfile && !all.Any(profile => profile.Name == name))
                .Select(name =>
                    $"{name}: the repository has the {name} profile, so its guards must run: pass new DatabaseProfile() (Suwgate.Database) to VerifyAll"
                ),
        ];
        foreach (
            var planned in all.Where(profile => settings.Profiles.Contains(profile.Name)).SelectMany(profile => profile.Guards(context))
        )
        {
            if (settings.Skips(planned.Id))
            {
                continue;
            }
            var found = Run(planned, settings.Exceptions);
            evidence.Record(planned.Id, found.Count == 0);
            problems.AddRange(found);
        }
        Guards.ThrowIfAny(problems);
    }

    private static List<string> Run(PlannedGuard planned, IReadOnlyList<ExceptionEntry> exceptions)
    {
        try
        {
            return Guards.Problems(planned.Create(), exceptions);
        }
        catch (Exception exception)
            when (exception is InvalidOperationException or InvalidDataException or IOException or ArgumentException)
        {
            return [$"{planned.Id}: {exception.Message}"];
        }
    }
}
