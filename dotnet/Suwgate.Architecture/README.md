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

One xUnit test runs every guard of the repository's profiles (`dotnet`: the architecture guards; `database`: the guards of
`Suwgate.Database`):

```csharp
public sealed class GuardTests
{
    [Fact]
    public void Every_guard_of_suwgate_passes() =>
        SuwgateGuards.VerifyAll(
            new GuardInputs { Production = [typeof(ServerApp).Assembly], Tests = [typeof(GuardTests).Assembly], Server = typeof(ServerApp) },
            new DatabaseProfile()
        );
}
```

`VerifyAll` reads the nearest `suwgate.yml` above the test's output folder (the profiles, `guards.skip`, the exceptions and the
settings), finds the rest in the repository itself (the one `*.slnx`, the layers file in the root, the C# sources, the test
projects' sources: every folder ending in `.Tests`, the migrations: the one folder `up` inside a folder `Migrations`, or the
`directory` setting of `database/migration-script-names`), runs every guard that is not skipped, and fails once with every problem.
What it cannot find, the test gives in `GuardInputs`:

| Input                          | What it is                                                                                                 |
| :----------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `Production`                   | the assemblies of the production projects (required)                                                       |
| `Tests`                        | the test assemblies the type guards read as well (the gate's own, so that `every-project-guarded` sees it) |
| `Server`                       | the type in the namespace that maps every endpoint; also an entry point of `no-unused-types`               |
| `EntryPoints`                  | full names of more types the runtime starts; every assembly's `Main` is one already                        |
| `FixtureField`, `ClassFixture` | the names `no-fixture-in-field` looks for (`TestApp`, `ClassServer`)                                       |

A guard that does not apply is skipped in `suwgate.yml` with its reason, where a reviewer sees it; `suwgate check` validates
the entry:

```yaml
guards:
    skip:
        - guard: architecture/endpoints
          reason: a library has no server, so there are no endpoints to map
```

The evidence: when `SUWGATE_EVIDENCE` names a directory (the `dotnet-test` step of `suwgate check` sets it to a new one for
every run), every guard that runs, through `VerifyAll` or `Guards.Verify(guard)`, appends `<guard id><TAB>passed|failed` to
`guards-<process id>.tsv` there. The step then fails unless every guard of the profiles that is not skipped is in it, so a
deleted or skipped guard test fails the gate. Without the variable nothing is written.

Each guard is also an `IGuard` of its own; a test can call `Guards.Verify(guard)`, which reads that guard's exceptions and fails
with every finding no exception names and every exception that names nothing. That is the API of 0.1, kept working; a repository
moves to `VerifyAll` and deletes its per-guard tests in the same change.

| Guard id                                             | Construct it with                                             | A finding's target                   |
| :--------------------------------------------------- | :------------------------------------------------------------ | :----------------------------------- |
| `architecture/layers`                                | the layers file and the layered assemblies                    | a type, or a namespace without layer |
| `architecture/endpoints`                             | the assembly, the mapping namespace, the suffix (`Endpoints`) | a type, or a crowded namespace       |
| `architecture/project-references`                    | the repository, the `.slnx` path, the layers file             | `A -> B`, `A internals -> B`, or `A` |
| `architecture/every-project-guarded`                 | the layers file and the assemblies the type guards read       | a project                            |
| `architecture/interfaces-have-two-implementations`   | `Of(assemblies)`                                              | an interface                         |
| `architecture/nothing-obsolete`                      | the assemblies                                                | a type or `Type.Member`              |
| `architecture/no-unused-types`                       | the assemblies and the entry points the runtime starts        | a type                               |
| `architecture/forbidden-type-names`                  | `Of(assemblies)`                                              | a namespace prefix or a type         |
| `architecture/unique-type-names`                     | `Of(assemblies)`                                              | a simple type name                   |
| `architecture/one-type-per-file`                     | `Repository.CSharpSources()`                                  | a file                               |
| `architecture/no-escape-hatches`                     | `Repository.CSharpSources()`                                  | a file                               |
| `architecture/no-fixture-in-field`                   | the test sources, the fixture's type, the class fixture       | a file                               |
| `architecture/build-settings`                        | the repository                                                | `file: Property`                     |
| `database/migration-script-names` (Suwgate.Database) | the migrations folder                                         | a script                             |

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
whose name ends with `.Tests` needs no layers, and neither does the gate: a project whose assembly references
`Suwgate.Architecture` or `Suwgate.Database` is a test project of the guards (a production project takes the package for its
build only), so `architecture/every-project-guarded` skips it without an exception. A project that builds under another name (`<AssemblyName>` in its
`.csproj`) is matched by that name when the layers file was read with `LayersFile.Read(repository, path)`.

```json
{
    "projects": {
        "Myapp.Server": { "layers": ["Api", "Notes | Health", "Database"], "internalsVisibleTo": ["Myapp.Gate", "Myapp.Server.Tests"] },
        "Myapp.Server.Tests": { "references": ["Myapp.Server"] },
        "Myapp.Gate": { "references": ["Myapp.Server"] }
    }
}
```
