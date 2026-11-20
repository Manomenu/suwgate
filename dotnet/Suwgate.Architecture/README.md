# Suwgate.Architecture

The build defaults of a .NET repository and the architecture guards of its xUnit tests, part of
[suwgate](https://github.com/Manomenu/suwgate). Exceptions to the guards live in the repository's `suwgate.yml`, each with its reason.

## The build defaults

Reference the package from every project, in `Directory.Build.props`:

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
    <RestoreLockedMode Condition="'$(CI)' != ''">true</RestoreLockedMode>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Suwgate.Architecture" PrivateAssets="all" IncludeAssets="build;buildTransitive;analyzers" />
  </ItemGroup>
</Project>
```

and give the gate's test project the code as well: `<PackageReference Update="Suwgate.Architecture" IncludeAssets="all" />`.
Every project then builds with:

- warnings as errors, `AnalysisLevel` `latest-all`, code style enforced in the build, nullable reference types, implicit usings,
  the latest C#, documentation files (so that unused usings are reported) and invariant globalization;
- the banned-API analyzer with the shared list (the clock, blocking on tasks, the console, reflection discovery, Newtonsoft); a
  `BannedSymbols.txt` in the repository root or above a project adds the repository's own lines;
- the analyzer rules as a global analyzer config, and in test projects the relaxations every test project needs (underscores in
  test names, public test classes, URIs as strings). The repository's `.editorconfig` keeps the whitespace and its own overrides,
  which win over the package's rules.

The target framework, warnings as errors and the lock files stay in `Directory.Build.props` as well: NuGet restores before it
imports any package, so without them there the lock files are off and NuGet audit only warns about a vulnerable package.
`architecture/build-settings` checks they are there and that no project turns a default off.

### The rules turned off, and why

| Rule                      | Where         | Why                                                                                                                 |
| :------------------------ | :------------ | :------------------------------------------------------------------------------------------------------------------ |
| IDE0055                   | all C#        | formatting is CSharpier's job; two formatters would fight                                                           |
| IDE0130 (on, as an error) | all C#        | a namespace is its folder path; set on its own so tuning the Style category can never switch it off                 |
| CA2007                    | all C#        | `ConfigureAwait(false)` matters under a synchronization context; ASP.NET Core and the test runner have none         |
| IDE0058                   | all C#        | builder APIs (`services.AddX()`) return themselves for chaining; discarding each with `_ =` hides the code          |
| IDE0045, IDE0046          | all C#        | they rewrite if/else into conditional expressions even when that nests ternaries or buries a throw                  |
| CA1032                    | all C#        | the standard exception constructor set is for exceptions others rethrow; ours are thrown once, with a message       |
| CS1591                    | all C#        | documentation files are on so that unused usings are reported, not to demand a `///` comment on every public member |
| CA1707, CA1515            | test projects | test names are sentences (`The_kit_tells_its_package_version`); xUnit needs public classes                          |
| CA1054, CA2234            | test projects | tests pass URIs as the strings they read in the request line                                                        |

## The guards

Each guard is an `IGuard`; a test calls `Guards.Verify(guard)`, which reads that guard's exceptions from the nearest `suwgate.yml`
above the test's output folder and fails with every finding no exception names and every exception that names nothing.

```csharp
public sealed class ArchitectureTests
{
    private static readonly RepositoryFiles Repository = RepositoryFiles.Find();
    private static readonly LayersFile LayersFile = LayersFile.Read(Repository, "Myapp.Gate/layers.json");
    private static readonly Assembly[] Assemblies = [typeof(ServerApp).Assembly, typeof(ArchitectureTests).Assembly];

    [Fact]
    public void Layers() => Guards.Verify(new Layers(LayersFile, typeof(ServerApp).Assembly));

    [Fact]
    public void Interfaces() => Guards.Verify(InterfacesHaveTwoImplementations.Of(Assemblies));
}
```

| Guard id                                           | Construct it with                                             | A finding's target                   |
| :------------------------------------------------- | :------------------------------------------------------------ | :----------------------------------- |
| `architecture/layers`                              | the layers file and the layered assemblies                    | a type, or a namespace without layer |
| `architecture/endpoints`                           | the assembly, the mapping namespace, the suffix (`Endpoints`) | a type, or a crowded namespace       |
| `architecture/project-references`                  | the repository, the `.slnx` path, the layers file             | `A -> B`, `A internals -> B`, or `A` |
| `architecture/every-project-guarded`               | the layers file and the assemblies the type guards read       | a project                            |
| `architecture/interfaces-have-two-implementations` | `Of(assemblies)`                                              | an interface                         |
| `architecture/nothing-obsolete`                    | the assemblies                                                | a type or `Type.Member`              |
| `architecture/no-unused-types`                     | the assemblies and the entry points the runtime starts        | a type                               |
| `architecture/forbidden-type-names`                | `Of(assemblies)`                                              | a namespace prefix or a type         |
| `architecture/unique-type-names`                   | `Of(assemblies)`                                              | a simple type name                   |
| `architecture/one-type-per-file`                   | `Repository.CSharpSources()`                                  | a file                               |
| `architecture/no-escape-hatches`                   | `Repository.CSharpSources()`                                  | a file                               |
| `architecture/no-fixture-in-field`                 | the test sources, the fixture's type, the class fixture       | a file                               |
| `architecture/build-settings`                      | the repository                                                | `file: Property`                     |

An exception names the guard and the target, and says why:

```yaml
exceptions:
    - guard: architecture/interfaces-have-two-implementations
      target: Myapp.Server.Payments.IPaymentGateway
      reason: the payment SDK takes an implementation of this interface; the second one is the SDK's test double
```

## The layers file

The repository's own file, read by `layers`, `project-references` and `every-project-guarded`. Every project of the solution is
listed with what it may reference and show its internals to; a production project lists its layers from the top down, the first
namespace segment under the project's name, with `|` between the parts of one level (they may not use each other). A project
whose name ends with `.Tests` needs no layers; a test project named otherwise (the gate) gets an exception of
`architecture/every-project-guarded` with that reason.

```json
{
    "projects": {
        "Myapp.Server": { "layers": ["Api", "Notes | Health", "Database"], "internalsVisibleTo": ["Myapp.Gate", "Myapp.Server.Tests"] },
        "Myapp.Server.Tests": { "references": ["Myapp.Server"] },
        "Myapp.Gate": { "references": ["Myapp.Server"] }
    }
}
```
