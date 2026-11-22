using System.Reflection;
using Suwgate.Architecture.Build;
using Suwgate.Architecture.Code;
using Suwgate.Architecture.Design;
using Suwgate.Architecture.Sources;
using Suwgate.Architecture.Verification;

namespace Suwgate.Architecture.Profiles;

public sealed class DotnetProfile : IGuardProfile
{
    public const string LayersPath = "layers.json";

    private const string SkipIt = "or skip the guard in suwgate.yml (guards.skip) with a reason";

    public string Name => "dotnet";

    public IReadOnlyList<PlannedGuard> Guards(ProfileContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var repository = context.Repository;
        var inputs = context.Inputs;
        var layers = new Lazy<LayersFile>(() => ReadLayers(repository));
        var sources = new Lazy<IReadOnlyList<SourceFile>>(repository.CSharpSources);
        Assembly[] all = [.. inputs.Production, .. inputs.Tests];
        return [new(Layers.GuardId, () => new Layers(layers.Value, Production(inputs))), new(Endpoints.GuardId, () =>
            {
                var server = Server(inputs);
                return new Endpoints(server.Assembly, server.Namespace ?? "", "Endpoints");
            }), new(ProjectReferences.GuardId, () => new ProjectReferences(repository, Solution(repository), layers.Value)), new(EveryProjectGuarded.GuardId, () => new EveryProjectGuarded(layers.Value, all)), new(InterfacesHaveTwoImplementations.GuardId, () => InterfacesHaveTwoImplementations.Of(all)), new(NothingObsolete.GuardId, () => new NothingObsolete(all)), new(NoUnusedTypes.GuardId, () =>
            {
                var names = new ProjectNames(repository);
                var production = Production(inputs);
                return new NoUnusedTypes(
                    production,
                    EntryPoints(inputs),
                    [.. production.Select(assembly => names.RootNamespaceOfAssembly(assembly.GetName().Name ?? ""))],
                    sources.Value
                );
            }), new(ForbiddenTypeNames.GuardId, () => ForbiddenTypeNames.Of(all)), new(UniqueTypeNames.GuardId, () => UniqueTypeNames.Of(all)), new(OneTypePerFile.GuardId, () => new OneTypePerFile(sources.Value)), new(NoEscapeHatches.GuardId, () => new NoEscapeHatches(sources.Value, NullForgivingInTests(context.Settings))), new(NoFixtureInField.GuardId, () => new NoFixtureInField([.. sources.Value.Where(file => file.InTestProject)], inputs.ServerTypes, inputs.ClassFixture)), new(BuildSettings.GuardId, () => new BuildSettings(repository))];
    }

    private static Assembly[] Production(GuardInputs inputs) =>
        inputs.Production.Count > 0
            ? [.. inputs.Production]
            : throw new InvalidOperationException(
                "GuardInputs.Production is empty: pass the assemblies of the production projects, e.g. [typeof(ServerApp).Assembly]"
            );

    private static LayersFile ReadLayers(RepositoryFiles repository) =>
        repository.Paths.Contains(LayersPath)
            ? LayersFile.Read(repository, LayersPath)
            : throw new InvalidOperationException(
                $"there is no {LayersPath} in the repository root: list every project of the solution there (the Suwgate.Architecture README shows how), {SkipIt}"
            );

    private static Type Server(GuardInputs inputs) =>
        inputs.Server
        ?? throw new InvalidOperationException(
            $"GuardInputs.Server is not set: set it to the type in the namespace that maps every endpoint, e.g. typeof(ServerApp), {SkipIt}"
        );

    private static string Solution(RepositoryFiles repository)
    {
        var solutions = repository
            .Paths.Where(path =>
                path.EndsWith(".slnx", StringComparison.Ordinal) && !path.Contains("node_modules/", StringComparison.Ordinal)
            )
            .ToList();
        return solutions.Count == 1
            ? solutions[0]
            : throw new InvalidOperationException(
                solutions.Count == 0
                    ? $"the repository has no .slnx: put every project into one solution file, {SkipIt}"
                    : $"the repository has {solutions.Count} .slnx files ({string.Join(", ", solutions)}): keep one solution with every project, {SkipIt}"
            );
    }

    private static string[] EntryPoints(GuardInputs inputs) =>
        [
            .. inputs.Production.Select(assembly => assembly.EntryPoint?.DeclaringType?.FullName).OfType<string>(),
            .. inputs.Server?.FullName is { } server ? [server] : Array.Empty<string>(),
            .. inputs.EntryPoints,
        ];

    private static bool NullForgivingInTests(SuwgateSettings settings) =>
        settings.Setting(NoEscapeHatches.GuardId, NoEscapeHatches.NullForgivingInTestsSetting) is { } value
        && (
            bool.TryParse(value, out var allowed)
                ? allowed
                : throw new InvalidDataException(
                    $"{settings.Path}: settings.{NoEscapeHatches.GuardId}.{NoEscapeHatches.NullForgivingInTestsSetting} is \"{value}\": set it to true or false"
                )
        );
}
