# Architecture

## The map

One line per top-level folder (at most 300 characters each).

- `src/` — the CLI: `cli.ts` (the commands; the one place that wires everything), `gate/` (the gate), `guards/` (repository guards, a folder per package), `profiles/` (steps per profile), `session/` (Claude Code hooks), `dev/` (`suwgate dev`: [dev.md](dev.md)).
- `schema/` — `suwgate.schema.json`, the JSON Schema of `suwgate.yml`; shipped in the npm package, read by the CLI and by VS Code (`yaml.schemas`).
- `dotnet/` — the .NET guards: `Suwgate.Architecture` (with the contract in `Verification/`), `Suwgate.Database`, and `Suwgate.Tests` (xUnit v3, one folder per package).
- `docs/` — for people working on suwgate: this map and the contracts, `development.md`, `inventory.md` (what is still to be moved here and by whom), decisions in `adr/`, specs in `visual/spec/` and drafts in `draft/spec/`.
- `.changeset/` — changesets of the CLI: one Markdown file per change waiting for the next release, and the config (base branch `master`, only `src/` and `schema/` need one).
- `.github/` — `workflows/ci.yml`: the gate on every push and pull request (suwgate checks itself from the sources), then on `master` the release of the CLI with changesets and npm trusted publishing.
- `.claude/` — the committed Claude Code settings: the Stop hook runs the quick gate, the PreToolUse hook refuses an agent's edit of the gate and of generated files; both are `suwgate hook` commands run from the sources.
- `.githooks/` — `pre-commit`: `suwgate hook pre-commit` from the sources (gitleaks on what is staged, then the quick gate); `just sync` enables it.
- `.config/` — `dotnet-tools.json`: CSharpier at a pinned version, for the `dotnet-format` step.
- `.vscode/` — the editor's glue: recommended extensions, formatter per language, `yaml.schemas` for `suwgate.yml`, tasks that run the gate. No style rules.

Files at the root: `suwgate.yml` (this repository's own gate), `package.json`, `tsconfig.json` (all TypeScript, checked),
`tsconfig.build.json` (what `tsc` emits into `dist/`), `vitest.config.ts`, `eslint.config.js`, `knip.json`, `.prettierrc.json`,
`Suwgate.slnx`, `Directory.Build.props`, `Directory.Packages.props`, `global.json`, `nuget.config`, `BannedSymbols.txt`.

## How a check runs

`suwgate check` finds the repository root (git), reads and validates `suwgate.yml`, and plans the steps:

1. the guards step first, which runs every repository guard whose profiles the repository has, in-process;
2. then the steps of each profile in the fixed order `web`, `library`, `dotnet`, `database`, then those of every repository
   (shellcheck, gitleaks), each step once even when two profiles bring it (web and library share the Node steps);
3. then the steps `steps.add` adds. `steps.skip` marks a step skipped with its reason.

Every step whose `after` steps are done starts at once, so independent steps run in parallel and the slowest one sets the
time. A step whose tool is missing is SKIP (a failure when `CI` is set); a step whose `after` step failed is not run and fails.
Each step has a ceiling (`limitSeconds`, `SUWGATE_STEP_LIMIT` overrides all); above it its process group is killed.

The report is quiet: a green gate prints one line with the step count, the time and the number of exceptions. Otherwise it
prints the last 25 lines of each failed step's output, then one line per failed or skipped step. `--verbose` lists every step.

`--quick` runs the guards (all but those marked `quick: false`) and only the steps with a `quick` run, which usually look at
the files changed since the branch left `master` (committed or not, plus untracked files); a step with nothing to look at
passes. The quick gate fails above its budget, `SUWGATE_QUICK_LIMIT` seconds (20 by default): the Stop hook runs it after
every turn of an agent, and a gate that takes minutes gets switched off.

Exit codes: 0 green, 1 red, 2 a usage problem or an invalid `suwgate.yml`, with every problem listed as `suwgate.yml:<line>:<column>`.

## The contract of a repository guard

A guard is a value of type `Guard` (`src/gate/contract.ts`), exported from its work package's folder in `src/guards/`:

| Field            | What it is                                                                                                         |
| :--------------- | :----------------------------------------------------------------------------------------------------------------- |
| `id`             | kebab-case, unique, stable: `suwgate.yml` names it in `exceptions` and `settings`; renaming it breaks repositories |
| `description`    | one sentence: what the guard keeps true                                                                            |
| `profiles`       | the profiles it runs for, or `"every"`                                                                             |
| `quick`          | `false` keeps it out of `--quick` (default: it runs there too, so keep it fast)                                    |
| `settingsSchema` | optional JSON Schema of its `settings.<id>` in `suwgate.yml`; without it the guard takes no settings               |
| `check(context)` | returns the findings (or a promise of them); it never throws on purpose, never prints, never exits                 |

`context` (`GuardContext`) gives `root`, `files` (every path of `git ls-files --cached --others --exclude-standard` that exists,
relative, with `/`), `profiles`, `directories` (where a profile's project lives), `exceptions` (this guard's, read-only), `settings`
(already validated by `settingsSchema`) and `read(file)`. A guard reads only what `files` lists, so `.gitignore` decides for all.

A finding is `{ target, message, line? }`. `target` is what an exception would name: a path, a type, an interface, a step. The
message states the fix. The gate, not the guard, applies the exceptions: a finding whose target an exception of this guard names
is counted as excepted, every other finding fails the guards step as `<id>: <target>[:<line>]: <message>`, and an exception that
matches no finding fails it too, until it is deleted. A guard that throws becomes a finding of its own, so one broken guard does
not hide the others.

To add a guard: write it with its test in your package's folder, add it to the array that folder's `index.ts` exports. Nothing in
`src/gate/` changes. `required-files` (`src/guards/repository/requiredFiles.ts`) is the example, end to end: a list per profile,
a setting for more files, a finding per missing file.

## The contract of a step

A step is a value of type `Step` (`src/gate/contract.ts`) in a profile's list in `src/profiles/`:

| Field          | What it is                                                                                                        |
| :------------- | :---------------------------------------------------------------------------------------------------------------- |
| `id`           | kebab-case, unique among all steps; `steps.skip` and `after` name it                                              |
| `title`        | what the report calls it, with the tool in brackets                                                               |
| `run`          | a bash command, or a function of the context that returns one (or `null`: nothing to check, so it passes)         |
| `quick`        | absent: full gate only; `true`: the same `run` in `--quick`; a command or function: what `--quick` runs instead   |
| `profile`      | the profile it belongs to: it runs in that profile's directory (`directories` in `suwgate.yml`), else in the root |
| `needs`        | the tools it calls; one missing from `PATH` makes it SKIP with the reason, never PASS                             |
| `after`        | steps that must finish first (the build before the tests); everything else runs in parallel                       |
| `limitSeconds` | its ceiling (300 by default)                                                                                      |

`StepContext` gives `root`, `cwd`, `quick` and `changed()`, the changed files relative to the root (`src/profiles/shell.ts` has the
helpers that filter them to a step's directory and quote them). A step's output is kept and shown only when it fails.

## The contract of a .NET guard

`Suwgate.Architecture` holds the contract in `Verification/`, and `Suwgate.Database` builds on it:

- a guard implements `IGuard`: `Id` (`architecture/<name>` or `database/<name>`, kebab-case; the CLI accepts exceptions with these
  prefixes for the `dotnet` and `database` profiles) and `Check()`, which returns `Finding(Target, Message)` values;
- the application's xUnit test calls `Guards.Verify(guard)`: it reads this guard's exceptions from the nearest `suwgate.yml` above
  the test's output folder (`SuwgateFile`), lets through what they name, and throws `GuardFailedException` listing every other
  finding and every exception that matches nothing;
- the packages depend on no test framework: a failed guard is an exception, which every runner reports as a failed test.

The examples: `InterfacesHaveTwoImplementations` (an interface with fewer than two implementations; an SDK's interface is the
case for an exception) and `MigrationScriptNames` (`NNNN_snake_case.sql`, each number once). `Suwgate.Tests` runs the first on
suwgate's own assemblies, with the exceptions of this repository's `suwgate.yml`.

## Who may import what

The `boundaries` rule of `eslint.config.js` keeps the contracts honest:

- a guard package (`src/guards/<package>/`) and `src/profiles/` import only `src/gate/contract.ts`, never each other;
- `src/gate/` imports nothing of the guards, the profiles or the hooks: it runs the guards and steps it is given;
- `src/guards/index.ts` puts the guard packages together; `src/cli.ts` alone wires the gate to them, to the profiles and to the hooks.

## Disabled lint and analyzer rules, and why

| Rule                                                   | Why                                                                                                           |
| :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `restrict-template-expressions` allows numbers         | messages and report lines are built from counts and seconds                                                   |
| `no-confusing-void-expression` ignores arrow shorthand | `(error) => reject(error)` style callbacks read better without braces                                         |
| `no-unused-vars` ignores rest siblings                 | dropping a key with `const { a: _, ...rest }` is on purpose                                                   |
| CA1707, CA1515, CA1812 off in `dotnet/Suwgate.Tests`   | test names use underscores, test classes are public for xUnit, sample types are inspected, never instantiated |

## Decisions the code relies on

- The gate applies the exceptions, not the guards: one place counts them, reports the stale ones and makes "every exception has a
  reason" true for every guard, including the ones not written yet.
- Guards run in-process and see the same file list; steps are shell commands in their own process group, so a hung tool can be
  killed with its children.
- The schema enumerates the profiles but not the guard ids: the ids come from the guards themselves, so the CLI checks them after
  the schema and lists the known ones in its message.
- The CLI runs from its TypeScript sources on Node 24 (type stripping): `src/` keeps to erasable syntax and imports with `.ts`
  extensions, which `tsc` rewrites to `.js` in `dist/`. The schema is read from `../../schema/` of the running file, the same depth
  from `src/gate/` and `dist/gate/`.
- The .NET packages read `suwgate.yml` with YamlDotNet and check only what they need (each exception has a guard, a target and a
  reason): the CLI validates the whole file against the schema.
- xUnit's generated entry point blocks on a task; `XUNIT_GENERATED_DISABLE_WARNINGS` in the test project is xUnit's own switch to
  keep the banned-API analyzer off that generated file, because editorconfig severities do not reach it.
