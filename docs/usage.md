# Using suwgate

The reference for a repository that installs `@maniumek/suwgate`: the gate and its configuration, the hooks, the shared rules
for agents, the tool presets and the .NET guards. The local stack (`suwgate dev`, with `api-types` and `slow-tests`) is in [dev.md](dev.md), the CI workflows and
Renovate in [ci.md](ci.md).

## Run the gate

```sh
pnpm exec suwgate check            # every step of the profiles and the repository guards, the same CI runs
pnpm exec suwgate check --quick    # the guards, and the quick steps for what changed since master
pnpm exec suwgate step             # the steps of this repository, with their titles
pnpm exec suwgate step e2e -- --headed -g notes   # one step and the steps it needs; after --, arguments for its tool
```

- `suwgate check` runs the guards step first, then the steps of each profile (in the order `web`, `library`, `dotnet`,
  `database`, then those every repository gets), then the steps `steps.add` adds. Every step whose `after` steps are done
  starts at once, so independent steps run in parallel.
- `--quick` runs the guards (all but the slow ones) and only the steps with a quick form, which look at the files changed since
  the branch left `master` (committed or not, plus untracked files). It fails above its budget, 20 seconds by default
  (`quick.limitSeconds`; a machine that is slow across the board sets `SUWGATE_QUICK_LIMIT=<seconds>`), because the Stop hook
  runs it after every turn of an agent, and a gate that takes minutes gets switched off.
- Every step has a ceiling (300 seconds unless the step says otherwise; `SUWGATE_STEP_LIMIT` overrides them all). A step whose
  tool is missing is SKIP and the report ends with `NOT VERIFIED: <steps>`; when `CI` is set a SKIP fails the gate.
- A green gate prints one line; a red one the last lines of each failed step and one line per failed or skipped step.
  `--verbose` lists every step with its time and shows the whole output of a failed one.
- Exit code: 0 green, 1 red, 2 a usage problem or an invalid `suwgate.yml` (every problem as `suwgate.yml:<line>:<column>`).

### One step

`suwgate step <id>` runs one step with the steps it needs (its `after`, transitively, so `pnpm-install` and the build come
with it) and prints the report `suwgate check` prints, with the same exit code. `--only` runs that step alone.

- After `--`, arguments go to the step's tool: `suwgate step e2e -- --headed -g notes` (Playwright),
  `suwgate step unit-tests -- -t "saves a note"` (Vitest), `suwgate step dotnet-test -- --filter-class "*Notes*"` (xUnit v3 on
  Microsoft.Testing.Platform: `--filter-class`, `--filter-method`, `--filter-namespace`, `--filter-trait name=value` and their
  `--filter-not-*`). The steps that take them: `unit-tests`, `stories`, `e2e`, `visual`, `consumer-app`, `dotnet-test`; any
  other step refuses `--` and names these.
- A step named on the command line runs even when `steps.skip` leaves it out of the gate; the steps it needs keep their skips.
- A step waits for some steps only for the order of the full gate (`e2e` for `dotnet-test` and `api-contract`, which rebuild the
  server): `suwgate step e2e` does not run them.
- It is not a gate pass: the Stop hook does not count it.
- A test step that ran 0 tests still fails (a filter that matches nothing is a mistake). With arguments, `dotnet-test` counts the
  tests of the whole run, not of each test project, and does not ask for the .NET guards' evidence, since a filtered run leaves
  guards out on purpose. `criteria-ran` reads the reports of the same run, so `suwgate step criteria-ran` runs every test step
  first, and with `--only` it has no reports and fails.

A recipe for people: `e2e *args:` then `@suwgate step e2e -- {{ args }}`.

## suwgate.yml

```yaml
profiles: [web, dotnet, database]
directories:
    web: Myapp.Web
steps:
    add:
        - name: api-diff
          run: scripts/.internal/api-diff.sh
          after: [dotnet-build]
    skip:
        - step: knip
          reason: the generated API client exports more than the app uses, and knip cannot tell
exceptions:
    - guard: architecture/interfaces-have-two-implementations
      target: Myapp.Server.Payments.IPaymentGateway
      reason: the payment SDK takes an implementation of this interface; the second one is the SDK's test double
```

- `profiles` (`web`, `library`, `dotnet`, `database`) bring their default steps and guards. A web-only repository runs nothing of
  .NET; the database guards run only with `database`. `directories` says where a profile's project lives.
- `steps.add` runs more (`name`, `run`, optionally `title`, `quick`, `after`, `limitSeconds`); `steps.skip` leaves a step out,
  always with a `reason`; `steps.configure` sets the knobs of a profile's step (below).
- `env` sets variables for every step and `unset` removes them (`*` and `?` match any characters, without regard to case, as .NET
  reads configuration): `unset: [Models__*, LLM_MODEL_*]` keeps every step away from a real model. A step's own `env` and `unset`
  in `steps.configure` come after them.
- `exceptions` let one target through one guard, always with a `reason`; `suwgate check` counts them in its report, and an
  exception that no longer matches anything fails the gate until it is deleted. Two optional fields, for the repository guards
  and the .NET guards alike:
    - `message` narrows it to the target's findings whose message contains that text, so a second finding in the same file still
      fails: `{ guard: no-raw-colors, target: Myapp.Web/src/mail.tsx, message: "#1e66f5", reason: … }`.
    - `once: true` makes it a one-time exception, for a finding that goes away once the change is on master, such as an
      owner-approved edit of an applied migration (`migrations-unchanged`). It holds only while master's `suwgate.yml` does not
      have it, that is on the branch that adds it. After the merge it excepts nothing and is never stale, so the first run on
      master stays green; the report asks to delete it with the next change.
- A reason shared by many exceptions can be a YAML anchor (`reason: &sdk the SDK implements it`, then `reason: *sdk`), up to
  10 000 aliases.
- `guards.skip` turns one whole guard off, always with a `reason`: a repository guard, or a .NET guard (`architecture/*`,
  `database/*`), which `SuwgateGuards.VerifyAll` then does not run and the `dotnet-test` step does not ask evidence for:
  `guards: { skip: [{ guard: architecture/endpoints, reason: a library has no server }] }`.
- `settings` configure a guard by its id, for example `dependency-direction: { applications: [Myapp.*] }`,
  `agents-file: { acronyms: [NUGET] }` or `docs-paths: { ignore: [Myapp.Web/node_modules/], skip: [docs/notes/**] }`; the schema of
  each guard's settings is in its source, and `suwgate check` validates them.
- `dev` configures `suwgate dev` ([dev.md](dev.md)).
- The schema ships in the package, `schema/suwgate.schema.json`. VS Code checks the file as you type with
  `"yaml.schemas": { "./node_modules/@maniumek/suwgate/schema/suwgate.schema.json": "suwgate.yml" }` in `.vscode/settings.json`.

### Configure a step of the profiles

```yaml
steps:
    configure:
        e2e:
            limitSeconds: 900
            after: [grammar]
            env: { E2E_MODEL: stand-in }
            unset: [Models__*]
            settings:
                before: ["rm -rf .artifacts/e2e/versions"]
```

`limitSeconds` replaces the step's ceiling, `after` adds steps it waits for, `env` and `unset` change its environment after the
top-level ones, and `settings` go to the step, checked by the step's own schema (the table in the README). A step that
`steps.skip` names cannot be configured. There is no `run`: replacing a step's command is `steps.skip` with the reason plus
`steps.add`, so the report shows that the profile's step did not run.

## The steps of the profiles

Each step looks where its profile lives (`directories`) and passes with nothing to check when the repository has nothing for it.

| Profile          | Steps                                                                                                                                                                                                                                                                                                                                           |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web`, `library` | `pnpm-install` (only without `node_modules`), `typecheck` (every `tsconfig*.json` but `tsconfig.build.json`), `lint`, `unit-tests` (the Vitest project `unit` when the config names one), `format`, `knip`                                                                                                                                      |
| `web`            | `e2e`: Playwright with `e2e/playwright.config.ts`; with a `dev` section, first the checkout's variables (`suwgate dev checkout-env`) and a fresh, empty `E2E_DATABASE`, then `settings.before`; Playwright's `webServer` starts and stops the server and the web app                                                                            |
| `library`        | `stories` (with `.storybook/`), `publint`, `attw`, `consumer-app` (packs the library into a copy of `gate/consumer/app`, builds it, runs `gate/consumer/playwright.config.ts`), `visual` (`visual/playwright.config.ts` in the Playwright image of the installed `@playwright/test`), `changeset`                                               |
| `dotnet`         | `dotnet-build`, `dotnet-format` (CSharpier), `dotnet-test` (fails on 0 tests and unless every .NET guard of the profiles ran; with a `dev` section, under the checkout's variables; `--quick`: only the test projects that use `Suwgate.Architecture` or `Suwgate.Database`); no idle MSBuild worker or build server is left behind             |
| `dotnet`, `web`  | with `contract/openapi.json` (or `settings.contract`): `api-contract` (the contract and the web app's `src/api/openapi.d.ts` regenerated from the server), `api-version` (oasdiff against master; a break needs a new major version in the `package.json` beside the contract), `contract-pins` (every test tagged `contract <name>@<version>`) |
| `database`       | `database-up`: `docker compose --profile db up -d --wait db`, or `dev.database.up`; not in CI, where the workflow starts it                                                                                                                                                                                                                     |
| every repository | `guards`, `compose` (with a compose file), `criteria`, `criteria-ran`, `shellcheck`, `gitleaks`                                                                                                                                                                                                                                                 |

## Acceptance criteria as guardrails

`criteria` runs `vdoc.py criteria` of the suwagent plugin, pinned by commit and SHA-256: every acceptance criterion of the specs in
`docs/visual/spec/` is named by a guardrail. The kinds of guardrail come with the profiles; `criteria.json` in the repository root
adds the repository's own (`{ "kinds": [{ "kind", "paths", "how" }] }`, optionally `specs` and `prose`), and the guard
`criteria-kinds` asks for a row of each in a table of `README.md` or `docs/development.md`. The default kinds:

| Kind                            | Profile          | Where (in the profile's directory)  | How the id is written                      |
| :------------------------------ | :--------------- | :---------------------------------- | :----------------------------------------- |
| `test (xunit)`                  | `dotnet`         | every project that references xunit | `[Trait("criterion", "<id>")]` on the test |
| `lint (.NET analyzer)`          | `dotnet`         | `.editorconfig`                     | `# <id>` on its own line above the rule    |
| `banned API`                    | `dotnet`         | `BannedSymbols.txt`                 | in the message: `P:…;<id> use …`           |
| `build rule`                    | `dotnet`         | `Directory.Build.props`             | `<!-- <id> -->` above the property         |
| `e2e test (playwright)`         | `web`            | `src/**/*.e2e.ts`                   | in the title: `test("<id>: …")`            |
| `web test (vitest)`             | `web`            | `src/**/*.test.ts(x)`               | in the title: `it("<id>: …")`              |
| `unit test (vitest)`            | `library`        | `src/**/*.test.ts(x)`               | in the title: `it("<id>: …")`              |
| `story test (vitest, Chromium)` | `library`        | `src/**/*.stories.tsx`              | in the story's name: `name: "<id>: …"`     |
| `visual test (playwright)`      | `library`        | `visual/*.visual.ts`                | in the title: `test("<id>: …")`            |
| `consumer test (playwright)`    | `library`        | `gate/consumer/*.spec.ts`           | in the title: `test("<id>: …")`            |
| `lint (eslint)`                 | `web`, `library` | `eslint.config.js`                  | `// <id>` on the line above the rule       |
| `type check (tsc)`              | `web`, `library` | `tsconfig*.json`                    | `// <id>` on the line above the option     |

`criteria-ran`, after the test steps: every criterion a test names must have a test naming it that ran and passed in this run, by
the reports of xUnit, Vitest and Playwright. A criterion named only by tests of a skipped step is not checked; one named only by
tests that `excludeTraits` of `dotnet-test` keeps out of the gate fails with the fix: a gate test with a stand-in.

## What the gate proves ran

A check counts only when the tool shows it ran, not because a file or a line of text is there:

- Zero tests fail: `unit-tests`, `stories`, `e2e` and `dotnet-test` fail when the tool ran no test, also when every test was
  skipped. A repository with truly no tests for a profile skips the step in `suwgate.yml` with a reason.
- The .NET guards: `dotnet-test` points `SUWGATE_EVIDENCE` at a fresh folder of the run, and every guard that runs writes its id
  and outcome there. The step fails unless every guard of the profiles that `guards.skip` does not name is in it, so a deleted
  guard test, a `[Fact(Skip = …)]` or a filtered-out one fails the gate.
- `typecheck` reads `tsc --showConfig` of every tsconfig it checks: the strict options of the preset must be in effect, so an
  override that turns one off fails, naming the option.
- `lint` reads `eslint --print-config` of a source file: `suwgate/no-comments` and `boundaries/dependencies` must be errors there.
- The kits are wired, not only installed: `suwbackkit-wiring` asks a web server that references `Suwbackkit.Server` to call
  `AddServerDefaults` and `MapServerDefaults`; `suwfrontkit-wiring` asks an app that depends on `@maniumek/suwfrontkit` to load
  its `theme.css` from the main module of its `index.html`, or from a stylesheet that module imports.
- `openapi-versions` keeps `Microsoft.Extensions.ApiDescription.Server`, which writes the OpenAPI contract at build, at the same
  version as `Microsoft.AspNetCore.OpenApi` in `Directory.Packages.props`: the tool loads the server's OpenAPI library and fails on
  a `Microsoft.OpenApi` mismatch, and pinning the library beside the tool makes an update move both.
- The reports live in a temporary folder of the run (`SUWGATE_RUN`), deleted when `suwgate check` ends. Every .NET test project
  tests with xUnit v3, since `dotnet-test` reads xUnit's XML reports.

## The repository guards

`suwgate check` runs them in-process as its first step, `guards`, and `--quick` runs them too (all but `scripts-help`). Each
reports every finding with the fix in its message; `suwgate.yml` holds the exceptions. The guard's one-line description is in its
source; the ones a person meets most:

| Guard                                                                  | Keeps true                                                                                                                                        |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agents-shared`                                                        | `AGENTS.shared.md` is the copy this suwgate ships, and `AGENTS.md` tells every agent to read it first (below)                                     |
| `agents-file`                                                          | `AGENTS.md` stays short, draws no directory tree and does not shout; `CLAUDE.md` only points to it                                                |
| `docs-paths`                                                           | every file and folder the Markdown docs name, in backticks or as a link, exists                                                                   |
| `human-docs`                                                           | the docs for people never tell a person to run a script meant for agents (`scripts/.internal/`); people run `just` recipes                        |
| `hooks`                                                                | the Claude Code hooks and the git hook are wired (below)                                                                                          |
| `forbidden-names`                                                      | no folder, project or file is named by a vague word (utils, helpers, common) or by the kind of thing it holds (services, components)              |
| `repository-layout`                                                    | every top-level folder has a line in the map of `docs/architecture.md`, no two files differ only in letter case, every shell script is executable |
| `required-files`, `config-contents`                                    | the files each profile needs are there and say what the gate relies on (below)                                                                    |
| `scripts-called`, `scripts-help`                                       | every script is called by something, and answers `--help` with a usage text                                                                       |
| `image-pins`, `compose-ports`                                          | every container image is pinned to a version, and compose publishes ports on the loopback only                                                    |
| `test-timing`                                                          | no test measures, sleeps on, waits for or limits real time: tests drive a fake clock                                                              |
| `migrations-unchanged`, `connection-host`                              | a migration on master is never changed; a connection string names the host by its address                                                         |
| `banned-npm-packages`, `banned-nuget-packages`, `dependency-direction` | no banned package, and a library never depends on an application                                                                                  |
| `comments-*`, `no-in-place-switches`                                   | no comment in code and config files but the ones a tool reads, and no in-place switch-off of a type checker, lint rule or analyzer                |

### What the config files must say

`required-files` asks for the files; `config-contents` checks that they say what the gate relies on, each where its profile lives,
and only when the profile is on and the file is there:

| File                                                      | Profile          | Must contain                                                                                                                 |
| :-------------------------------------------------------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `global.json`                                             | `dotnet`         | an exact `sdk.version`, a `sdk.rollForward` other than `major` and `latestMajor`, `test.runner` `Microsoft.Testing.Platform` |
| `.editorconfig`                                           | `dotnet`         | `max_line_length = 140` for the files CSharpier formats; a `.csharpierrc*` must go, it would win over it                     |
| `Directory.Packages.props`                                | `dotnet`         | `<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>`                                                      |
| `tsconfig*.json` (not `tsconfig.build.json`)              | `web`, `library` | `extends` `@maniumek/suwgate/tsconfig/...`, directly or through another tsconfig of the repository                           |
| `eslint.config.js`, `knip.config.ts`, the Vitest config   | `web`, `library` | an import of `@maniumek/suwgate/eslint`, `/knip`, `/vitest`                                                                  |
| `.prettierrc.json` or `prettier.config.js`                | `web`, `library` | exactly `"@maniumek/suwgate/prettier"`, or an import of it                                                                   |
| `e2e/playwright.config.ts`, `visual/playwright.config.ts` | `web`, `library` | an import of `@maniumek/suwgate/playwright`                                                                                  |
| the `package.json` that installs suwgate                  | every            | `@maniumek/suwgate` at an exact version: no `^`, `~`, range or tag                                                           |
| `pnpm-workspace.yaml`                                     | every            | no `minimumReleaseAge` of 0; `minimumReleaseAgeExclude` is fine                                                              |
| `.vscode/settings.json`                                   | every            | `yaml.schemas` mapping the schema of the installed suwgate to `suwgate.yml`                                                  |
| `.github/workflows/*.yml`                                 | every            | a job with `uses: Manomenu/suwgate/.github/workflows/gate.yml@<full 40-character commit sha>`                                |

`required-files` also asks the `dotnet` profile for exactly one `*.slnx` in its directory, and for `Directory.Build.rsp`
(`-nodeReuse:false`, so no idle MSBuild worker stays behind).

## Hooks

`.claude/settings.json` wires the two Claude Code hooks:

```json
{
    "hooks": {
        "Stop": [
            { "hooks": [{ "type": "command", "command": "\"${CLAUDE_PROJECT_DIR}/node_modules/.bin/suwgate\" hook stop", "timeout": 600 }] }
        ],
        "PreToolUse": [
            {
                "matcher": "Edit|Write|MultiEdit|NotebookEdit",
                "hooks": [{ "type": "command", "command": "\"${CLAUDE_PROJECT_DIR}/node_modules/.bin/suwgate\" hook guard-edit" }]
            }
        ]
    }
}
```

and `.githooks/pre-commit` (`git config core.hooksPath .githooks` enables it) the git hook:

```sh
#!/usr/bin/env bash
exec node_modules/.bin/suwgate hook pre-commit
```

- `hook stop` runs the quick gate after an agent's turn, unless nothing changed since it last passed. Red, it hands the agent the
  end of the report, and the agent keeps working.
- `hook guard-edit` refuses an agent's edit of the gate (`suwgate.yml`, the criteria file, the hooks, the workflows,
  `.editorconfig`, and the lint, type and build configs of the repository's profiles) until the owner starts a session with
  `ALLOW_GATE_EDIT=1`. It always refuses generated files (lockfiles, the API contract and types) with the command that
  regenerates them and an existing migration script, and refuses a recorded characterization test that git tracks. It guards only
  files of its own project (`CLAUDE_PROJECT_DIR`, else the checkout it runs in), so a session never blocks another repository.
  `settings.hooks` adds the repository's own: `protected` (globs), `generated` (`path` and `command`), `recordings`, `migrations`.
- `hook pre-commit` runs gitleaks on the staged changes, then the quick gate, and refuses the commit if either fails
  ([adr/0001-suwgate-hook-pre-commit.md](adr/0001-suwgate-hook-pre-commit.md)).
- The `hooks` guard checks that these lines are there.

## The shared rules for agents

`AGENTS.shared.md` holds the rules every repository of the stack shares (git, test last, specs, names, secrets, no comments), so a
change to one of them is one release of suwgate, not a pull request in every repository. suwgate ships it, and
`suwgate agents-shared` writes it into the repository root. The `agents-shared` guard fails while the copy differs from the one the
installed suwgate ships (after an upgrade: run the command and commit the copy; the Renovate preset does it in the upgrade's pull
request), and while `AGENTS.md` lacks the line

```text
Read @AGENTS.shared.md first: the rules every repository of the stack shares. This file adds this repository's own and wins where it says otherwise.
```

outside a code block. Claude Code loads the file through the `@` (`CLAUDE.md` imports `AGENTS.md`, which imports it); every other
agent follows the words. `AGENTS.md` keeps only what is the repository's own.

## The tool presets

The configs of the tools the steps run extend suwgate's, so an application keeps only its own paths:

| Tool       | The application's file                                                                                                                                                                                                                     |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier   | `.prettierrc.json`: `"@maniumek/suwgate/prettier"` (with a plugin: spread it in `prettier.config.js`)                                                                                                                                      |
| TypeScript | `{ "extends": "@maniumek/suwgate/tsconfig/browser", "include": ["src"] }`; `tsconfig/node` for the configs, scripts and tests run by Node; `tsconfig/strict` for the options alone                                                         |
| knip       | `knip.config.ts`: `export { default } from "@maniumek/suwgate/knip"`, or `knip({ entry: [...] })`; it ignores the tools the steps run and the issues of the generated API types, and reads the steps' Playwright configs                   |
| Vitest     | `unitTests({ environment: "jsdom" })` and `storyTests({ plugin, provider })` from `@maniumek/suwgate/vitest`: the projects `unit` and `stories` the steps run                                                                              |
| Playwright | `defineConfig(e2eTests({ use: { baseURL }, webServer, reporter }))` or `defineConfig(visualTests())` from `@maniumek/suwgate/playwright`; `e2eTests` keeps the app's `reporter` and adds the JSON report the `e2e` step reads              |
| ESLint     | `app({ root, features, shared, sharedImports, storage })` from `@maniumek/suwgate/eslint`: a feature imports itself and the shared folders, a shared folder only itself and what `sharedImports` allows it; `strict()` for the rules alone |

## The .NET guards

`Suwgate.Architecture` brings the build defaults of every project (warnings as errors, the analyzers, the banned APIs) and the
architecture guards; `Suwgate.Database` the database guards. One xUnit test in the gate's test project runs every guard of the
`dotnet` and `database` profiles:

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

`VerifyAll` reads the nearest `suwgate.yml` above the test's output folder (profiles, `guards.skip`, exceptions, settings), finds
the solution, `layers.json`, the sources and the migrations itself, and takes from the test only what it cannot find. The guards,
their inputs and the build defaults: [Suwgate.Architecture](../dotnet/Suwgate.Architecture/README.md).
