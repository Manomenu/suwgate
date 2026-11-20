# @maniumek/suwgate

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
