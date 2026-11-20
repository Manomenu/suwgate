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

A setting under a `Condition` (on the property, its `PropertyGroup` or a `When`) counts only where a normal build meets the
condition: `Configuration` `Debug` or `Release`, `CI` and `GITHUB_ACTIONS` unset or `true`, every other property empty unless the
repository's MSBuild files set it unconditionally to a plain value. So an override behind a switch only an explicit build sets
(`<PropertyGroup Condition="'$(SuwagcmsSdkPath)' != ''">`, passed as `-p:SuwagcmsSdkPath=…`) is allowed, one behind
`'$(Configuration)' == 'Debug'` or `'$(CI)' == ''` is not, and a restore setting in the root props counts only when every normal
build sets it. A condition the guard cannot evaluate (`Exists(…)`, property functions, items, an `Otherwise`) is treated as one that
may hold: write it as `'$(Property)' == 'value'`, or add an exception with the reason. The guard reads the operators of
[MSBuild conditions](https://learn.microsoft.com/visualstudio/msbuild/msbuild-conditions): `==` and `!=` (case-insensitive), `<`,
`>`, `<=`, `>=` on numbers, `!`, `and`, `or` and parentheses.

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

| Input          | What it is                                                                                                 |
| :------------- | :--------------------------------------------------------------------------------------------------------- |
| `Production`   | the assemblies of the production projects (required)                                                       |
| `Tests`        | the test assemblies the type guards read as well (the gate's own, so that `every-project-guarded` sees it) |
| `Server`       | the type in the namespace that maps every endpoint; also an entry point of `no-unused-types`               |
| `EntryPoints`  | full names of more types the runtime starts; every assembly's `Main` is one already                        |
| `ServerTypes`  | the types that start a test server, for `no-fixture-in-field` (`WebApplicationFactory`, `TestServer`)      |
| `ClassFixture` | the class fixture that `no-fixture-in-field` names in its fix (`ClassServer`)                              |

A guard's settings live in `suwgate.yml` under `settings.<guard id>`; `suwgate check` validates them:

| Setting                                                        | What it does                                                                                         |
| :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `architecture/no-escape-hatches`: `nullForgivingInTests: true` | allows the null-forgiving `!` in the sources of test projects (folders ending in `.Tests`)           |
| `database/migration-script-names`: `directory: <folder>`       | the folder of the migration scripts, when it is not the one folder `up` inside a folder `Migrations` |

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
| `architecture/no-unused-types`                       | the assemblies, the entry points, root namespaces, sources    | a type                               |
| `architecture/forbidden-type-names`                  | `Of(assemblies)`                                              | a namespace prefix or a type         |
| `architecture/unique-type-names`                     | `Of(assemblies)`                                              | a simple type name                   |
| `architecture/one-type-per-file`                     | `Repository.CSharpSources()`                                  | a file                               |
| `architecture/no-escape-hatches`                     | `Repository.CSharpSources()`, `!` allowed in tests or not     | a file                               |
| `architecture/no-fixture-in-field`                   | the test sources, the server types, the class fixture         | a file                               |
| `architecture/build-settings`                        | the repository                                                | `file: Property`                     |
| `database/migration-script-names` (Suwgate.Database) | the migrations folder                                         | a script                             |

An exception names the guard and the target, and says why:

```yaml
exceptions:
    - guard: architecture/interfaces-have-two-implementations
      target: Myapp.Server.Payments.IPaymentGateway
      reason: the payment SDK takes an implementation of this interface; the second one is the SDK's test double
```

Some guards read more than the compiled references:

- `no-unused-types` counts a type as used when compiled code loses its name: a constant of it named in another type's source
  (`CamelCase.Pattern`, which the compiler inlines, in `[GeneratedRegex(CamelCase.Pattern)]` or in code), the type named in an
  attribute argument (`[Kind(Other = typeof(Marker))]`), or a call from an async lambda or top-level statements (read from the IL of
  the compiler-generated types). The sources are matched by the type's simple name.
- `no-fixture-in-field` looks at test classes (a class with a `[Fact]` or `[Theory]` method, or an attribute whose name ends in one of
  them): a field or property initializer, or an assignment in a constructor, that starts a server fails, because xUnit makes the
  class anew for every test. Starting means `new T(…)`, `new()` for a member of type `T`, or `T.Create(…)` (any static call on `T`),
  where `T` is one of `ServerTypes` or a class of the test sources that derives from one (`TestApp : WebApplicationFactory<Program>`).
  The class fixture itself has no tests, so it may start the server; a field that reads the fixture's server (`= server.App`) passes.
  A repository whose own type is named like a default (a `TestServer` wrapper of the fixture) passes `ServerTypes` without it.

## The layers file

The repository's own file, read by `layers`, `project-references` and `every-project-guarded`. Every project of the solution is
listed with what it may reference and show its internals to; a production project lists its layers from the top down, with `|`
between the parts of one level (they may not use each other). A part is a namespace under the project's root namespace:

- one segment (`Notes`) or several (`Conversation.Turns`); a namespace belongs to the longest part it starts with, so
  `Procedures` and `Procedures.Steps` can sit on different levels;
- `.` is the root namespace itself; without it the types there are not checked and anything may use them;
- a namespace that no part covers is a finding, named by its shortest prefix no part starts with.

`areas` gives a part of the layers (an area: `Orders | Billing` on one level, which never use each other) an order of its own
features, in the same syntax, relative to the area: features use only the features below them, the area's own namespace is free
unless its layers list `.`, and a namespace of the area that its order does not cover is a finding. `"subFeatures": true` makes every
namespace one level inside a feature (a part, or a feature of an area) a sub-feature: it may use its feature and everything below,
but neither its feature nor its sibling sub-features may use it.

```json
{
    "projects": {
        "Myapp.Server": {
            "layers": ["Api", "Orders | Billing", "Notifications", "Database"],
            "areas": { "Orders": ["Checkout", "Cart | Payment"], "Billing": ["Invoices", "Taxes"] },
            "subFeatures": true,
            "internalsVisibleTo": ["Myapp.Gate", "Myapp.Server.Tests"]
        },
        "Myapp.Cli": { "layers": [".", "Commands", "Output", "Files"], "references": ["Myapp.Server"] },
        "Myapp.Server.Tests": { "references": ["Myapp.Server"] },
        "Myapp.Gate": { "references": ["Myapp.Server", "Myapp.Cli"] }
    }
}
```

A project whose name ends with `.Tests` needs no layers, and neither does the gate: a project whose assembly references
`Suwgate.Architecture` or `Suwgate.Database` is a test project of the guards (a production project takes the package for its
build only), so `architecture/every-project-guarded` skips it without an exception. A project is keyed by its `.csproj` name; its
assembly and its root namespace come from `<AssemblyName>` and `<RootNamespace>` of the `.csproj` (each, like MSBuild, the project
name when it is not set or is an MSBuild expression) when the layers file was read with `LayersFile.Read(repository, path)`, as
`VerifyAll` does. So a CLI that builds as `myapp` with the root namespace `Myapp.Cli` is checked under `Myapp.Cli`, and
`no-unused-types` reads every production assembly under its project's root namespace.
