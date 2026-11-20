# @maniumek/suwgate

## 0.4.0

### Minor Changes

- a1bdd1b: `suwgate.yml` accepts `settings: architecture/no-escape-hatches: nullForgivingInTests: true`, the setting of Suwgate.Architecture 0.3.0 that allows the null-forgiving `!` in the sources of test projects, for repositories whose AGENTS.md allows it there; the per-file exceptions for it can go.
- e9dbdb7: - `suwgate step <id> [--only] [--verbose] [-- <args>]` runs one step with the steps it needs (or alone with `--only`), with the
    report and exit code of `suwgate check`; arguments after `--` go to the step's tool (`unit-tests`, `stories`: Vitest; `e2e`,
    `visual`, `consumer-app`: Playwright; `dotnet-test`: xUnit v3 on Microsoft.Testing.Platform), every other step refuses them.
    `suwgate step` alone lists the steps. It is not a gate pass for the Stop hook; a step named on the command line runs even when
    `steps.skip` leaves it out of the gate; `dotnet-test` asks the .NET guards' evidence only without arguments.
  - `steps.configure.<step>`: `limitSeconds`, `after`, `env`, `unset` (globs, without regard to case) and `settings`, checked by the
    step's own schema; top-level `env` and `unset` for every step. Settings: `e2e.before` (commands before Playwright),
    `dotnet-test.excludeTraits` (tests outside the gate, `--filter-not-trait`; `criteria-ran` names a criterion only they name),
    `api-contract.contract` (where the contract is), `api-version.breaking: never`.
  - `dev.database.up` and `dev.database.psql`: a database that is not a compose service; `suwgate dev db up|psql`, the
    `database-up` and `e2e` steps run them. `gate.yml` takes `database-command`.
  - Exceptions take `message` (only the target's findings whose message contains it) and `once: true` (a one-time exception: holds on
    the branch that adds it, excepts nothing and is never stale once master has it). YAML anchors may be used up to 10 000 times.
  - `--verbose` prints the whole output of a failed step.
  - `e2eTests()` keeps the app's `reporter` and adds the JSON report the `e2e` step reads; the step no longer passes `--reporter`.
  
  What a repository must change: an `e2e/playwright.config.ts` whose reporter is set outside `e2eTests()` moves it inside, or the
  `e2e` step finds no report. A repository with its own e2e script, contract check or database wrapper can replace it with the
  knobs above (README: "Run one step", "Configure a step of the profiles").

### Patch Changes

- e9dbdb7: Fixes found while moving eight repositories onto suwgate:
  
  - `comments-hash` reads no comment inside a YAML block scalar (`|`, `>`), and takes just recipe parameters with defaults
    (`logs service="":`) and `mod <name> '<path>'` as the line a recipe comment describes.
  - `no-raw-colors` leaves HTML entities (`&#106;`) alone.
  - `just-modules` accepts `mod <name> '<path>'`, a file or a folder with `mod.just`, `justfile` or `.justfile`.
  - `appsettings-bound` reads `BindConfiguration(XOptions.Section)` and `GetSection(...)` through a `const string`.
  - `image-pins` leaves a Helm template image (`{{ … }}`) to the deployment.
  - `scripts-called` counts only the commands of `suwgate.yml` (`steps.add` run, `steps.configure`, `env`, `dev`), not its
    exceptions and reasons, and counts a Claude Code plugin's `hooks/hooks.json` as a caller.
  - The knip preset ignores `prettier` as a step's tool and no longer earns "Remove from ignore" for the generated API types.
  - `app()` of the ESLint preset gives the import resolver the first project only, so it no longer prints "Multiple projects found".
- 959fcd2: `suwgate dev logs` shows the trace of an ASP.NET Core log line again: the JSON console formatter writes `TraceId` in `Scopes`, not at the
  top of the line, so no line of a real server showed `trace=`. Nothing changes for a repository.

## 0.3.0

### Minor Changes

- 3d80b32: - `criteria-ran` (every repository, after the test steps): an acceptance criterion of a living spec that a test names must have
    a test naming it that ran and passed in this gate run, by the reports of xUnit (`--report-xunit-xml`), Vitest and Playwright
    (JSON). `visual` and `consumer-app` now write Playwright's JSON report as well, and fail when 0 tests ran.
  - `suwbackkit-wiring` (dotnet): a web server that references `Suwbackkit.Server` calls `AddServerDefaults` and `MapServerDefaults`.
  - `suwfrontkit-wiring` (web, library): an app that depends on `@maniumek/suwfrontkit` loads `@maniumek/suwfrontkit/theme.css` from
    its main module or a stylesheet that module imports.
  
  What a repository must change: un-skip, or make pass, every test that names a criterion; a skipped test step leaves its criteria
  out of the check. Wire the kits where the new guards say so.
- 35efd25: The gate proves that a check ran, from what the tool reports, instead of trusting that a file or a line of text is there:
  
  - `dotnet-test` sets `SUWGATE_EVIDENCE` to a fresh folder of the run and fails unless every .NET guard of the profiles ran
    (`SuwgateGuards.VerifyAll` of Suwgate.Architecture 0.2.0, or `Guards.Verify`), so a deleted or skipped guard test fails the gate.
    It also runs `dotnet test --zero-tests-policy strict --report-xunit-xml` and fails when no test ran.
  - `guards.skip` in `suwgate.yml` turns one whole guard off with a reason: a repository guard, or a .NET guard. The CLI knows the
    .NET guard ids and validates the entries; `settings` take `database/migration-script-names: { directory }`.
  - `unit-tests`, `stories` and `e2e` fail when Vitest or Playwright ran 0 tests (their JSON reports).
  - `typecheck` reads `tsc --showConfig` of every tsconfig and fails when a strict option of the preset is off; `lint` reads
    `eslint --print-config` of a source file and fails unless `suwgate/no-comments` and `boundaries/dependencies` are errors.
  
  What a repository must change: on the `dotnet` profile, reference Suwgate.Architecture 0.2.0 and replace the per-guard tests with
  one `SuwgateGuards.VerifyAll` test (or keep `Guards.Verify` for every guard), skip the guards that do not apply in `guards.skip`
  with a reason; give every test step at least one test that runs, or skip the step with a reason; a library's ESLint config needs
  `boundaries/dependencies` at error for its `src/` files.

## 0.2.0

### Minor Changes

- f2c98df: - `docs-paths` takes `skip`, globs of documents it does not read at all (`docs-paths: { skip: [docs/notes/**] }`).
  - `app()` of `@maniumek/suwgate/eslint` takes `sharedImports`, the edges allowed between shared folders
    (`sharedImports: [["design", "api"]]`); every other import between shared folders still fails.
- f2c98df: New guard `config-contents`: the config files suwgate relies on must say what it needs (README, "What the config files must say"):
  an exact `sdk.version`, a `sdk.rollForward` short of a major and `test.runner` `Microsoft.Testing.Platform` in `global.json`;
  `max_line_length = 140` for C# and the MSBuild files in `.editorconfig`, and no `.csharpierrc*` (delete `.csharpierrc.json`: CSharpier
  reads the width from `.editorconfig`, and a `.csharpierrc` would win over it); `ManagePackageVersionsCentrally` in
  `Directory.Packages.props`; the suwgate presets in the tsconfig, ESLint, Prettier, knip, Vitest and Playwright configs; an exact
  `@maniumek/suwgate` version; no `minimumReleaseAge: 0`; the schema in `yaml.schemas`; and a CI job that calls
  `Manomenu/suwgate/.github/workflows/gate.yml` pinned by its full commit sha. A repository fixes each finding as its message says, or
  adds an exception with the reason.
- f2c98df: The `e2e` step works for a real app: with a `dev` section in `suwgate.yml` it applies `suwgate dev checkout-env`, starts the
  database (`suwgate dev db up`), drops and creates the checkout's empty `E2E_DATABASE`, then runs Playwright, whose `webServer`
  starts and stops the server and the web app. A repository deletes its own fresh-database step, its `skip: e2e` and its
  `scripts/.internal/e2e.sh`.
- f2c98df: `required-files` asks the `dotnet` profile for `Directory.Build.rsp` (`-nodeReuse:false`) and for exactly one `*.slnx` in its
  directory. A repository without them adds them (`dotnet new sln --format slnx`, or `dotnet sln migrate` for an old `.sln`).

### Patch Changes

- f2c98df: Fixes found while moving the template, suwbackkit and alfusion onto suwgate:
  
  - `dotnet-test --quick` finds a gate project that references the guards with `<PackageReference Update="Suwgate.Architecture" />`.
  - `docs-paths` reads a .NET guard id such as `architecture/layers` as a guard, not as a missing path.
  - `repository-layout` reads the map only from the section `## The map` of `docs/architecture.md`, and asks for that section when it
    is missing.
  - The .NET steps (`dotnet-build`, `dotnet-format`, `dotnet-test`, `api-contract`) set `MSBUILDDISABLENODEREUSE=1` and
    `DOTNET_CLI_USE_MSBUILD_SERVER=0`, so no idle MSBuild worker or build server stays behind.
  - `dotnet-test` runs under `suwgate dev checkout-env` when `suwgate.yml` has a `dev` section, so two worktrees never share a test
    database.
  - `no-raw-colors` leaves the tests out (`*.test.*`, `*.spec.*`, `*.e2e.*`).
  - `comments-eslint` leaves out the web app's generated `src/api/openapi.d.ts`, which the `api-contract` step checks: its exception
    in `suwgate.yml` can go.
- ae45c63: `quick.limitSeconds` in `suwgate.yml` sets the budget of `suwgate check --quick` for the repository (default 20 seconds);
  `SUWGATE_QUICK_LIMIT` on a machine still overrides it.
- e4af576: The guard `forbidden-names` refuses `base` only in the name of a folder or project, no longer in a file's: a file is named after the
  type it holds, and `architecture/forbidden-type-names` allows Base in a type's name (`KnowledgeBaseView.cs`), as it forbids it only as
  a namespace segment.

## 0.1.1

### Patch Changes

- a6a38e2: The `unit-tests` step runs only the Vitest project `unit` also when the config builds it with `unitTests()` of the preset
  (it ran every project, the stories in Chromium among them). `suwgate hook guard-edit` protects `knip.config.ts` and
  `prettier.config.js`, the files the knip and Prettier presets are extended in.
  The guard `required-files` accepts `prettier.config.js` in place of `.prettierrc.json`, as the README says for a Prettier
  config with a plugin.

## 0.1.0

### Minor Changes

- 79cf8f1: The comment guards: `comments-hash`, `comments-css`, `comments-json`, `comments-markup`, `comments-sql`, `comments-csharp`,
  `comments-eslint` and `no-in-place-switches` refuse every comment but the tool directives of AGENTS.md, "No comments", and every
  in-place switch (`@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `#pragma warning disable`). `@maniumek/suwgate/eslint` exports the
  rule `no-comments` (as the plugin `suwgate`), `strict()` (the strict and stylistic type-checked sets, `suwgate/no-comments`, no
  inline configuration) and `app()` (also the feature boundaries of `src/` and the browser-storage ban), so a repository drops its own
  copy of the rule. A repository that switches over: extend `strict()` or `app({ features, shared, storage })` in `eslint.config.js`,
  delete its local `no-comments` rule, its `eslint-disable` allowance and the comment tests of its own gate, and install the peer
  dependencies it lints with (eslint, @eslint/js, typescript-eslint, eslint-plugin-boundaries, eslint-import-resolver-typescript).
- 8e61d15: Two guards of the profile `database`: `migrations-unchanged` (a migration script that exists on master is not changed or deleted;
  the setting `folders` replaces the default `Database/Migrations/up/`) and `connection-host` (no connection string says `Host=` followed by the host's name; write `Host=127.0.0.1`).
- ada6ada: Three guards for the `dotnet` profile: `banned-nuget-packages` (no MediatR, AutoMapper, Mapster, Scrutor, Moq, NSubstitute,
  FakeItEasy, FluentAssertions, Newtonsoft.Json or EF Core, more through `settings.banned-nuget-packages.packages`),
  `unused-nuget-versions` (every version of `Directory.Packages.props` is referenced) and `appsettings-bound` (every section of
  `appsettings*.json` is read by `BindConfiguration`, `GetSection` or `GetRequiredSection`).
- d361d1d: The first suwgate CLI: `suwgate check [--quick] [--verbose]` reads and validates `suwgate.yml` (profiles, directories, steps to add
  or skip, exceptions from the guards, each with its reason), runs the steps of the profiles `web`, `library`, `dotnet` and
  `database` in parallel with the repository guards, and reports PASS or FAIL with times and the number of exceptions.
  `suwgate hook guard-edit` and `suwgate hook stop` are the Claude Code hooks. The first guard is `required-files`.
- c5cb645: The steps of the profiles replace the check scripts of the template and of suwfrontkit: `pnpm-install`, `typecheck` over every
  `tsconfig*.json` but the build one, `unit-tests` of the Vitest project `unit`, `stories`, `consumer-app`, `visual`, `e2e`,
  `database-up`, `compose`, `criteria` (pinned `vdoc.py`, default kinds of guardrail per profile, more in a root `criteria.json`),
  and the contract steps `api-contract`, `api-version` and `contract-pins`, which pass when a repository has no `contract/openapi.json`.
  `dotnet-test --quick` runs only the test projects of the .NET guards. `attw` leaves out CSS and JSON entry points and runs after
  `publint`, so the two never pack at once. The new guard `criteria-kinds` asks for a docs row of each kind `criteria.json` adds.
  Presets an application extends in one line: `@maniumek/suwgate/prettier`, `/tsconfig/strict`, `/tsconfig/browser`, `/tsconfig/node`,
  `/knip`, `/vitest` and `/playwright`. A step's `run` may return `{ skip: reason }`, and a run with nothing to check passes
  before its tools are looked for. What a repository changes: its `criteria.json` moves to the root and keeps only its own kinds;
  its scripts check.sh, criteria.sh, api-types.sh --check, api-diff.sh, contracts.sh, package.sh and visual.sh leave the gate.
- 7505315: The repository guards of the template and suwfrontkit move into the CLI: `agents-file`, `docs-paths`, `forbidden-names`,
  `repository-layout`, `scripts-called`, `scripts-help` (full gate only), `just-modules`, `image-pins`, `compose-ports`,
  `vscode-settings`, `banned-npm-packages`, `no-raw-colors`, and two new ones: `dependency-direction` (a library never depends at
  runtime on an application; `settings.dependency-direction.forbidden` rules packages out of any repository) and `hooks` (the Claude
  Code hooks and the git hook are wired). `required-files` now also asks for `suwgate.yml`, `criteria.json`, the VS Code settings and,
  with `dotnet`, `layers.json`, and says what each missing file is for.
  
  `suwgate hook guard-edit` guards only its own project and protects the gate files of the repository's profiles; `settings.hooks`
  adds a repository's own gate files (`protected`), generated files with their command (`generated`), recorded tests
  (`recordings`) and migration scripts (`migrations`). The new `suwgate hook pre-commit` runs gitleaks on the staged changes, then the
  quick gate.
  
  What a repository changes: its `.githooks/pre-commit` becomes `exec <suwgate> hook pre-commit`; a file the new guards report
  is fixed, or gets an exception with its reason.
- abfafda: `suwgate dev db|logs|smoke|server|tmux|checkout-env`: the template's dev scripts as commands, configured by a new `dev` section of
  `suwgate.yml` (the app's `name`, `portOffset` or `ports`, the compose file and services, the database, the server project, the smoke
  checks); paths come from `directories`. See docs/dev.md. A repository that adds `dev:` to `suwgate.yml` needs nothing else; the
  section is new, so no existing `suwgate.yml` changes.
