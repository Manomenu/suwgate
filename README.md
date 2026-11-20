# suwgate

One quality gate for every project: `suwgate check` runs the steps a project's profiles need and the repository guards, configured in `suwgate.yml`. The CLI is the npm package `@maniumek/suwgate`; the .NET guards are the NuGet packages `Suwgate.Architecture` and `Suwgate.Database`.

## Use it

```sh
pnpm add -D @maniumek/suwgate
pnpm exec suwgate check            # the whole gate, the same CI runs
pnpm exec suwgate check --quick    # the guards, and the quick steps for what changed since master
```

`suwgate.yml` in the repository root says what the repository is and where it departs from the defaults:

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

- `profiles` (`web`, `library`, `dotnet`, `database`) bring their default steps in their order (the table below). A web-only repository runs nothing of .NET; the database
  guards run only with `database`.
- `steps.add` runs more (`name`, `run`, optionally `title`, `quick`, `after`, `limitSeconds`); `steps.skip` leaves a step out,
  always with a `reason`.
- `quick.limitSeconds` is the budget of `suwgate check --quick` (default 20): the quick gate fails above it. A machine that is slow
  across the board overrides it with `SUWGATE_QUICK_LIMIT=<seconds>`.
- `exceptions` let one target through one guard, always with a `reason`; `suwgate check` counts them in its report, and an
  exception that no longer matches anything fails the gate until it is deleted.
- `guards.skip` turns one whole guard off, always with a `reason`: a repository guard, or a .NET guard (`architecture/*`,
  `database/*`), which `SuwgateGuards.VerifyAll` then does not run and the `dotnet-test` step does not ask evidence for. A
  library, for example: `guards: { skip: [{ guard: architecture/endpoints, reason: a library has no server }] }`.
- The schema is in the package, `schema/suwgate.schema.json`. VS Code checks the file as you type with
  `"yaml.schemas": { "./node_modules/@maniumek/suwgate/schema/suwgate.schema.json": "suwgate.yml" }` in `.vscode/settings.json`.
- `settings` configure a guard by its id, for example `dependency-direction: { applications: [Myapp.*] }`,
  `agents-file: { acronyms: [NUGET] }` or `docs-paths: { ignore: [Myapp.Web/node_modules/], skip: [docs/notes/**] }` (`ignore`: names the
  docs may mention that are not paths here; `skip`: documents, by glob, that docs-paths does not read at all); the schema of each
  guard's settings is in its source, and `suwgate check` validates them.

## Hooks

Three lines wire the hooks; `.claude/settings.json`:

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

and `.githooks/pre-commit` (`git config core.hooksPath .githooks` enables it):

```sh
#!/usr/bin/env bash
exec node_modules/.bin/suwgate hook pre-commit
```

- `hook stop` runs the quick gate after an agent's turn, unless nothing changed since it last passed.
- `hook guard-edit` refuses an agent's edit of the gate (`suwgate.yml`, the criteria file, the hooks, the workflows, `.editorconfig`,
  and the lint, type and build configs of the repository's profiles, the layers file of a .NET server among them) until the owner starts a session
  with `ALLOW_GATE_EDIT=1`. It always refuses generated files (lockfiles, the API contract and types) with the command that
  regenerates them and an existing migration script, and refuses a recorded characterization test that git tracks. It guards only
  files of its own project (`CLAUDE_PROJECT_DIR`, else the checkout it runs in), so a session never blocks another repository.
  `settings.hooks` adds the repository's own: `protected` (globs), `generated` (`path` and `command`), `recordings`, `migrations`.
- `hook pre-commit` runs gitleaks on the staged changes, then the quick gate, and refuses the commit if either fails
  ([docs/adr/0001-suwgate-hook-pre-commit.md](docs/adr/0001-suwgate-hook-pre-commit.md)).
- The `hooks` guard checks that these lines are there.

### The steps of the profiles

Each step looks where its profile lives (`directories`) and passes with nothing to check when the repository has nothing for it.

| Profile          | Steps                                                                                                                                                                                                                                                                                                                                                                                                    |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web`, `library` | `pnpm-install` (only without `node_modules`), `typecheck` (every `tsconfig*.json` but `tsconfig.build.json`, with `tsc --showConfig`), `lint` (with `eslint --print-config`), `unit-tests` (the Vitest project `unit` when the config names one; 0 tests fail), `format`, `knip`                                                                                                                         |
| `web`            | `e2e`: `playwright test -c e2e/playwright.config.ts`, after the build, the database and the .NET tests; with a `dev` section, first the checkout's variables (`suwgate dev checkout-env`) and a fresh, empty `E2E_DATABASE` (`dev db up`, then drop and create it); Playwright's `webServer` starts and stops the server and the web app                                                                 |
| `library`        | `stories` (with `.storybook/`), `publint`, `attw`, `consumer-app` (packs the library into a copy of `gate/consumer/app`, builds it, runs `gate/consumer/playwright.config.ts`), `visual` (`visual/playwright.config.ts` in the Playwright image of the installed `@playwright/test`), `changeset`                                                                                                        |
| `dotnet`         | `dotnet-build`, `dotnet-format`, `dotnet-test` (fails on 0 tests and unless every .NET guard of the profiles ran; with a `dev` section, under the checkout's variables, so two worktrees never share a test database; `--quick`: only the test projects that use `Suwgate.Architecture` or `Suwgate.Database`); every .NET step leaves no idle MSBuild worker or build server behind                     |
| `dotnet`, `web`  | with `contract/openapi.json`: `api-contract` (the contract and `src/api/openapi.d.ts` of the web app regenerated from the server's project, the one that references `Microsoft.Extensions.ApiDescription.Server`), `api-version` (oasdiff against master; a break needs a new major version in `contract/package.json`), `contract-pins` (every test tagged `contract <name>@<version>` names a version) |
| `database`       | `database-up`: `docker compose --profile db up -d --wait db`, not in CI                                                                                                                                                                                                                                                                                                                                  |
| every repository | `compose` (with a compose file), `criteria`, `shellcheck`, `gitleaks`                                                                                                                                                                                                                                                                                                                                    |

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

### The tool presets

The configs of the tools the steps run extend suwgate's, so an application keeps only its own paths:

| Tool       | The application's file                                                                                                                                                                                                                                    |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier   | `.prettierrc.json`: `"@maniumek/suwgate/prettier"` (with a plugin: spread it in `prettier.config.js`)                                                                                                                                                     |
| TypeScript | `{ "extends": "@maniumek/suwgate/tsconfig/browser", "include": ["src"] }`; `tsconfig/node` for the configs, scripts and tests run by Node; `tsconfig/strict` for the options alone                                                                        |
| knip       | `knip.config.ts`: `export { default } from "@maniumek/suwgate/knip"`, or `knip({ entry: [...] })`; it ignores the tools the steps run and the generated API types, and reads the steps' Playwright configs                                                |
| Vitest     | `unitTests({ environment: "jsdom" })` and `storyTests({ plugin, provider })` from `@maniumek/suwgate/vitest`: the projects `unit` and `stories` the steps run                                                                                             |
| Playwright | `defineConfig(e2eTests({ use: { baseURL }, webServer }))` or `defineConfig(visualTests())` from `@maniumek/suwgate/playwright`                                                                                                                            |
| ESLint     | `app({ root, features, shared, sharedImports, storage })` from `@maniumek/suwgate/eslint`: a feature imports itself and the shared folders, a shared folder only itself and what `sharedImports` allows it (`[["design", "api"]]`: design may import api) |

### What the config files must say

`required-files` asks for the files; `config-contents` checks that they say what the gate relies on, each where its profile lives
(`directories`), and only when the profile is on and the file is there:

| File                                                                          | Profile          | Must contain                                                                                                                                           |
| :---------------------------------------------------------------------------- | :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global.json`                                                                 | `dotnet`         | an exact `sdk.version` (`10.0.100`), a `sdk.rollForward` other than `major` and `latestMajor`, `test.runner` `Microsoft.Testing.Platform`              |
| `.editorconfig` (the root's, then the dotnet directory's)                     | `dotnet`         | `max_line_length = 140` for `*.cs`, `*.csproj`, `*.props` and `*.targets`: CSharpier's width; a `.csharpierrc*` anywhere must go, it would win over it |
| `Directory.Packages.props`                                                    | `dotnet`         | `<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>`                                                                                |
| `tsconfig*.json` (not `tsconfig.build.json`, which the typecheck step skips)  | `web`, `library` | `extends` `@maniumek/suwgate/tsconfig/...`, directly or through another tsconfig of the repository                                                     |
| `eslint.config.js`, `knip.config.ts`, the Vitest config                       | `web`, `library` | an import of `@maniumek/suwgate/eslint`, `/knip`, `/vitest`                                                                                            |
| `.prettierrc.json` or `prettier.config.js`                                    | `web`, `library` | exactly `"@maniumek/suwgate/prettier"`, or an import of it                                                                                             |
| `e2e/playwright.config.ts`, `visual/playwright.config.ts`                     | `web`, `library` | an import of `@maniumek/suwgate/playwright`                                                                                                            |
| `package.json` that installs suwgate (the root or a web or library directory) | every            | `@maniumek/suwgate` at an exact version: no `^`, `~`, range or tag                                                                                     |
| `pnpm-workspace.yaml` (web, library, and where suwgate is installed)          | every            | no `minimumReleaseAge` of 0 (pnpm waits 1440 minutes by default); `minimumReleaseAgeExclude` is fine                                                   |
| `.vscode/settings.json`                                                       | every            | `yaml.schemas` mapping `./node_modules/@maniumek/suwgate/schema/suwgate.schema.json` (or under a profile's directory) to `suwgate.yml`                 |
| `.github/workflows/*.yml`                                                     | every            | a job with `uses: Manomenu/suwgate/.github/workflows/gate.yml@<full 40-character commit sha>`                                                          |

`required-files` also asks the `dotnet` profile for exactly one `*.slnx` in its directory, and for `Directory.Build.rsp`
(`-nodeReuse:false`, so no idle MSBuild worker stays behind).

### The .NET guards

One xUnit test in the gate's test project runs every guard of the `dotnet` and `database` profiles:

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
the solution, `layers.json`, the sources and the migrations itself, and takes from the test only what it cannot find
([dotnet/Suwgate.Architecture/README.md](dotnet/Suwgate.Architecture/README.md) lists the inputs).

### What the gate proves ran

A check counts only when the tool shows it ran, not because a file or a line of text is there:

- The .NET guards: `dotnet-test` points `SUWGATE_EVIDENCE` at a fresh folder of this gate run, and every guard that runs (through
  `VerifyAll` or `Guards.Verify`) writes its id and outcome there. The step fails unless every guard of the profiles that
  `guards.skip` does not name is in it, so a deleted guard test, a `[Fact(Skip = …)]` or a filtered-out one fails the gate.
- Zero tests fail: `unit-tests`, `stories` (Vitest, its JSON report), `e2e` (Playwright, its JSON report) and `dotnet-test`
  (`--zero-tests-policy strict` of Microsoft.Testing.Platform, and xUnit's XML report) fail when the tool ran no test, also when
  every test was skipped. A repository with truly no tests for a profile skips the step in `suwgate.yml` with a reason.
- `typecheck` reads `tsc --showConfig` of every tsconfig it checks: the strict options of the suwgate preset must be in effect, so
  an override that turns one off fails, naming the option.
- `lint` reads `eslint --print-config` of a source file of `src/`: `suwgate/no-comments` and `boundaries/dependencies` must be
  errors there.
- The reports live in a temporary folder of the run (`SUWGATE_RUN`), deleted when `suwgate check` ends. `dotnet-test` asks xUnit
  for its XML report (`--report-xunit-xml`), so every .NET test project tests with xUnit v3.

`suwgate dev db|logs|smoke|server|tmux|checkout-env` runs the local stack of the template (database, logs, smoke test, server, tmux
session, worktree databases) from a `dev` section of `suwgate.yml`: [docs/dev.md](docs/dev.md).

## Work on suwgate

[AGENTS.md](AGENTS.md) holds the rules, [docs/development.md](docs/development.md) the setup, [docs/architecture.md](docs/architecture.md)
the contract of a guard and a step, and [docs/inventory.md](docs/inventory.md) what is still to be moved here from the template and the kits.

## Licence

MIT, see [LICENSE](LICENSE).
