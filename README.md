<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/hero-dark.png">
  <img alt="suwgate, npm CLI and NuGet guards. One quality gate for every repository: one command runs the steps of its profiles and its guards, configured in one suwgate.yml. Tags: suwgate check, agent hooks, suwgate dev, CI workflows, Renovate preset. Terminal: suwgate check --quick prints PASS, all 8 steps in 4s (14 exceptions in suwgate.yml); suwgate step dotnet-test prints PASS, all 2 steps in 55s. Numbers: 4 profiles (web, library, dotnet, database), 25 steps the profiles bring, 36 repository guards, 14 .NET guards in xUnit, 3 hooks for agents and git, 3 reusable CI workflows." src="docs/visual/board/img/readme/hero-light.png" width="100%">
</picture>

suwgate is the one quality gate of a stack of repositories that agents and one developer work on: the CLI
[`@maniumek/suwgate`](https://www.npmjs.com/package/@maniumek/suwgate) on npm, and the .NET guards `Suwgate.Architecture` and
`Suwgate.Database` on NuGet. A repository says what it is in `suwgate.yml`; suwgate brings the steps, the guards, the hooks, the
tool presets, the local dev commands, the CI workflows and the Renovate preset.

## Install

Node 24 or later, pnpm, and a git repository:

```sh
pnpm add -D --save-exact @maniumek/suwgate
```

pnpm installs a version only once it is a day old (`minimumReleaseAge`). To take a new suwgate the day it is published, exclude the
package by name in `pnpm-workspace.yaml`: `minimumReleaseAgeExclude: ["@maniumek/suwgate"]`.

## Quick start

```sh
printf 'profiles: [web]\n' > suwgate.yml      # or library, dotnet, database, several at once
pnpm exec suwgate agents-shared                 # writes AGENTS.shared.md, the rules every repository shares
pnpm exec suwgate check                         # the whole gate; every finding says how to fix it
```

The first run lists what the repository still lacks (the hooks, the tool configs, the line in `AGENTS.md` that reads the shared
rules), each finding with its fix. Then, while working:

```sh
pnpm exec suwgate check --quick    # the guards, and the quick steps for what changed since master (20 s budget)
pnpm exec suwgate step             # the steps of this repository
pnpm exec suwgate step unit-tests -- -t "saves a note"   # one step and what it needs; after --, its tool's arguments
```

Wiring the hooks (`.claude/settings.json`, `.githooks/pre-commit`) and every other detail: [docs/usage.md](docs/usage.md).

## Why

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/why-dark.png">
  <img alt="Why one gate. Each repository on its own: its own check script, ci.yml, hooks and lint configs, copied and drifting apart; an agent says done with the tests red; an agent loosens a lint rule or edits a lockfile to get through; eslint-disable, #pragma and skipped tests hide exceptions in the code; a test file deleted or filtered out passes in silence; CI runs the gate again on a merge commit it already tested; dependency pull requests every day, merged by hand. With suwgate: one package, the repository keeps suwgate.yml and its own code; the Stop hook runs the quick gate after every turn and red blocks the end of the turn; guard-edit refuses an agent's edit of the gate and of generated files; every exception is in suwgate.yml with a reason and a stale one fails; 0 tests run fails, and every .NET guard must leave evidence it ran; a tree stamp skips a tree that already passed; one Renovate run a week, two pull requests, merged when green." src="docs/visual/board/img/readme/why-light.png" width="100%">
</picture>

## How a change goes through it

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/flow-dark.png">
  <img alt="How a change goes through it. On your machine: an agent edits, and guard-edit runs before every edit (gate files refused; lockfiles, API types and migrations refused); the turn ends, and stop runs the quick gate within 20 seconds (guards and changed files, skipped when nothing changed); git commit runs pre-commit (gitleaks, then the quick gate; staged secrets refused); before done, suwgate check runs the full gate (every step, in parallel, browser tests included). In CI, gate.yml: proof asks whether the tree already passed, in a few seconds (a green ci/tree stamp of the same tree skips the gate); gate runs suwgate check --verbose (a SKIP fails in CI); stack runs the smoke test when smoke is true (its own compose project, free ports); stamp writes ci/tree after green (the merge push is proven); release with release-npm or release-nuget (the publish job stays in the caller). Every step has a ceiling; a missing tool is SKIP, and SKIP fails in CI; exit 0 green, 1 red, 2 usage or suwgate.yml problem." src="docs/visual/board/img/readme/flow-light.png" width="100%">
</picture>

The quick gate is what an agent meets after every turn, so it has a time budget; the full gate is what CI runs. A step that cannot
run here (its tool is missing) is reported as not verified, never as passed.

## The gate

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/gate-dark.png">
  <img alt="The gate: profiles and their steps. web, a web app: pnpm-install, typecheck, lint, unit-tests, format, knip, e2e (Playwright, fresh database). library, an npm package: the Node steps, stories, publint, attw, consumer-app, visual, changeset (packed as npm ships it). dotnet, a .NET solution: dotnet-build, dotnet-format, dotnet-test, which runs the .NET guards (xUnit v3, CSharpier). database, PostgreSQL: database-up, the database guards, migrations stay unchanged (compose or your script). web and dotnet together: api-contract, api-version (oasdiff), contract-pins. Every repository: guards, compose, criteria, criteria-ran, shellcheck, gitleaks. Proof, not presence: 0 tests fail (Vitest, Playwright and xUnit reports, a run with no test is red); .NET evidence (every .NET guard of the profiles writes that it ran, or dotnet-test fails); configs in effect (tsc --showConfig and eslint --print-config keep the strict options on); criteria-ran (each acceptance criterion a test names ran and passed in this run). --quick: the guards and the quick steps, only for what changed since master, budget 20 s (quick.limitSeconds, SUWGATE_QUICK_LIMIT)." src="docs/visual/board/img/readme/gate-light.png" width="100%">
</picture>

Independent steps run in parallel, and each looks only where its profile lives. The steps of each profile, the criteria kinds and
what each step proves: [docs/usage.md](docs/usage.md#the-steps-of-the-profiles).

## The guards

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/guards-dark.png">
  <img alt="The guards. Repository guards, 36, in-process, the step guards. Agents: agents-shared, agents-file, hooks, human-docs, docs-paths. Layout and names: repository-layout, forbidden-names, required-files, just-modules. Configs: config-contents, vscode-settings, image-pins, compose-ports. Scripts: scripts-called, scripts-help (answers --help). Dependencies: banned-npm-packages, banned-nuget-packages, unused-nuget-versions, dependency-direction. No comments: comments-hash, comments-css, comments-json, comments-markup, comments-sql, comments-csharp, comments-eslint, no-in-place-switches. Tests: test-timing, tests drive a fake clock, never real time. Kits wired: suwfrontkit-wiring, suwbackkit-wiring, openapi-versions, no-raw-colors, appsettings-bound. Database: connection-host, migrations-unchanged. Criteria: criteria-kinds, a repository's own kinds of guardrail are explained. .NET guards, NuGet, one xUnit test calls SuwgateGuards.VerifyAll. Suwgate.Architecture: architecture/ layers, endpoints, project-references, every-project-guarded, interfaces-have-two-implementations, nothing-obsolete, no-unused-types, forbidden-type-names, unique-type-names, one-type-per-file, no-escape-hatches, no-fixture-in-field, build-settings; and the build defaults: warnings as errors, analyzers, banned APIs. Suwgate.Database: database/ migration-script-names, NNNN_snake_case.sql, each number once. suwgate.yml: exceptions let one target through one guard, with a reason; a stale one fails; once: true for one branch; guards.skip and steps.skip, with a reason." src="docs/visual/board/img/readme/guards-light.png" width="100%">
</picture>

A guard reports every finding with its fix and never decides an exception itself: `suwgate.yml` holds the exceptions, each with
its reason. The .NET guards and build defaults: [Suwgate.Architecture](dotnet/Suwgate.Architecture/README.md).

## For agents

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/agents-dark.png">
  <img alt="For agents. hook guard-edit, Claude Code PreToolUse: refuses an edit of the gate (suwgate.yml, hooks, workflows, lint and type configs) and of generated files; ALLOW_GATE_EDIT=1 lifts the gate part. hook stop, Claude Code Stop: runs the quick gate after every turn, unless nothing changed since it last passed; red, the agent keeps working. hook pre-commit, git: gitleaks on the staged changes, then the quick gate; .githooks/pre-commit. AGENTS.shared.md: the rules every repository shares (test last, git, specs, names, secrets, no comments); suwgate agents-shared writes the copy; the agents-shared guard fails until it is current and AGENTS.md reads it first. Acceptance criteria as guardrails: every criterion id of a spec in docs/visual/spec/ is named by a test, a lint rule or a build rule (criteria), and the tests that name it ran and passed (criteria-ran)." src="docs/visual/board/img/readme/agents-light.png" width="100%">
</picture>

## suwgate dev

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/dev-dark.png">
  <img alt="suwgate dev: the local stack. db (up, down, reset, psql, logs, status): the PostgreSQL of the compose file, or your own script. server (dotnet watch): restarted when it exits, output teed to a JSON log. tmux (start [--restart], stop): shell, server and web app in one session. logs (why did it fail?): the last warnings and errors; --trace one request. smoke (read-only requests): --ci builds and starts its own stack on free ports. checkout-env (eval in a worktree): own test databases and e2e ports per linked worktree. sibling (image, up, rebuild, down, status), new: a sibling repository's images, rebuilt when its checkout moved on. dev: in suwgate.yml: only name is required; portOffset keeps repositories on one machine apart." src="docs/visual/board/img/readme/dev-light.png" width="100%">
</picture>

```sh
suwgate dev tmux start                 # the whole local stack in one tmux session
eval "$(suwgate dev checkout-env)"     # in a linked worktree: its own test databases and e2e ports
suwgate dev sibling suwagcms up        # a sibling's images, rebuilt if its checkout moved on, then started
```

Every subcommand answers `--help`. The `dev` section and what each command does: [docs/dev.md](docs/dev.md).

## CI, releases and dependencies

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/ci-dark.png">
  <img alt="CI, releases and dependencies. Reusable workflows, pinned by commit: gate.yml (proof, gate, smoke, stamp; tools installed with checksums; consumer: a kit tested in a real app); release-npm.yml (changesets: the Version Packages pull request, then build and pack; npm trusted publishing); release-nuget.yml (full history, dotnet pack in Release, the artifact nupkg; NuGet trusted publishing). Self-hosted fallback: private repositories move to local runners when the month's Actions minutes run out: CI_RUNNER=suw-local, set and cleared by a timer. Renovate for every repository: once a week (new pull requests on Monday before 6:00 Warsaw time); two pull requests (minor and patch in one, majors in the other); merged on green (Renovate merges once the checks pass, a red one stays open); holds follow peers (TypeScript held to what typescript-eslint accepts, moved by pull request)." src="docs/visual/board/img/readme/ci-light.png" width="100%">
</picture>

A repository's whole `ci.yml` can be one job:

```yaml
jobs:
    gate:
        permissions:
            contents: read
            statuses: write
            pull-requests: read
        uses: Manomenu/suwgate/.github/workflows/gate.yml@<full commit sha>
        with:
            browser: chromium
```

The inputs, the tree stamp, the consumer test, trusted publishing and the Renovate preset: [docs/ci.md](docs/ci.md); the
self-hosted runners: [ci/self-hosted](ci/self-hosted/README.md).

## Which command, when

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/choose-dark.png">
  <img alt="Which command, when. While an agent works, after every turn: suwgate check --quick (the Stop hook). Before calling a change done: suwgate check (the full gate). Which steps does this repository have: suwgate step (lists them). One step, with what it needs, and its tool's flags: suwgate step e2e -- --headed. Run the whole local stack: suwgate dev tmux start. The server failed, why: suwgate dev logs. A linked worktree needs its own databases and ports: suwgate dev checkout-env, with eval. A sibling repository's images are behind its checkout: suwgate dev sibling name up. suwgate was upgraded and agents-shared is red: suwgate agents-shared (writes the copy)." src="docs/visual/board/img/readme/choose-light.png" width="100%">
</picture>

<details>
<summary>suwgate --help</summary>

```text
usage: suwgate check [--quick] [--verbose] | suwgate step [<id> [--only] [--verbose] [-- <args>]] | suwgate hook <guard-edit|stop|pre-commit> | suwgate dev <command> | suwgate agents-shared | suwgate --help | --version
  suwgate check            every step of the repository's profiles (suwgate.yml) and the repository guards
  suwgate check --quick    the guards, and the quick steps only for what changed since master; has a time budget
                           (SUWGATE_QUICK_LIMIT seconds, default 20) because the Stop hook runs it after every turn
  --verbose                list every step with its time, also when all pass, and the whole output of a failed step
  suwgate step             the steps of this repository, with their titles and the tool that takes -- arguments
  suwgate step <id>        one step and the steps it needs (after, transitively), with the same report; not a gate
                           pass: the Stop hook does not count it. --only: that step alone. After --, arguments for the
                           step's tool: suwgate step e2e -- --headed -g notes (Playwright), suwgate step unit-tests --
                           -t "name" (Vitest), suwgate step dotnet-test -- --filter-method "*Notes*" (xUnit v3)
  suwgate hook guard-edit  Claude Code PreToolUse hook: refuses an agent's edit of the gate and of generated files
                           (ALLOW_GATE_EDIT=1 lifts the gate part for one session); only files of its own project
                           (CLAUDE_PROJECT_DIR, else the git checkout it runs in), with the lists of its profiles
  suwgate hook stop        Claude Code Stop hook: runs the quick gate unless nothing changed since it last passed
  suwgate hook pre-commit  git pre-commit hook: gitleaks on the staged changes, then the quick gate
  suwgate dev <db|logs|smoke|server|tmux|sibling|checkout-env>
                           the local stack of the repository (the dev section of suwgate.yml), and the images of the
                           sibling repositories it runs, rebuilt from their checkouts when stale; suwgate dev --help
  suwgate agents-shared    writes AGENTS.shared.md, the rules every repository shares, as this suwgate ships it, into the
                           repository root (the agents-shared guard fails until the copy is current)
  suwgate verdict <tests|guards|tsconfig|eslint> ...
                           what the steps call after their tool: did tests run, did the .NET guards run (evidence),
                           are the strict compiler options and the eslint rules in effect
Every step has a ceiling (SUWGATE_STEP_LIMIT seconds overrides them all). A step whose tool is missing is SKIP,
and a SKIP fails the gate when CI is set. Exit code: 0 green, 1 red, 2 a usage or suwgate.yml problem.
```

</details>

## Configuration

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/visual/board/img/readme/settings-dark.png">
  <img alt="What suwgate.yml configures. profiles: what the repository is, the steps and guards follow (web, library, dotnet, database). directories: where each profile's project lives (web: Myapp.Web). steps.add, skip, configure: more steps; one left out with a reason; a step's ceiling, after, env, settings. quick.limitSeconds: the budget of the quick gate (20). exceptions: guard, target, reason; optional message and once; a stale one fails. guards.skip: a whole guard off, with a reason. settings.guard: a guard's own knobs, validated by its schema (docs-paths: ignore). env and unset: variables of every step; unset: [Models__*]. dev: name, portOffset, ports, compose, database, siblings (name: myapp). schema: checked as you type in VS Code, exit 2 when invalid, always on. Tool presets your configs extend: ESLint app() and strict(); Prettier, the shared options; knip(); Vitest unitTests() and storyTests(); Playwright e2eTests() and visualTests(); tsconfig strict, browser, node." src="docs/visual/board/img/readme/settings-light.png" width="100%">
</picture>

```yaml
profiles: [web, dotnet, database]
directories:
    web: Myapp.Web
steps:
    skip:
        - step: knip
          reason: the generated API client exports more than the app uses, and knip cannot tell
exceptions:
    - guard: architecture/interfaces-have-two-implementations
      target: Myapp.Server.Payments.IPaymentGateway
      reason: the payment SDK takes an implementation of this interface; the second one is the SDK's test double
```

| Key                      | What it does                                                                                       |
| :----------------------- | :------------------------------------------------------------------------------------------------- |
| `profiles`               | `web`, `library`, `dotnet`, `database`: the steps and guards the repository gets                   |
| `directories`            | where a profile's project lives when it is not the root                                            |
| `steps.add`              | more steps: `name`, `run`, optionally `title`, `quick`, `after`, `limitSeconds`                    |
| `steps.skip`             | a step of the profiles left out, with its `reason`                                                 |
| `steps.configure.<step>` | a profile's step: `limitSeconds`, more `after`, `env`, `unset`, `settings` (below)                 |
| `env`, `unset`           | variables set for every step, and variables no step sees (`*` and `?` match)                       |
| `quick.limitSeconds`     | the budget of `suwgate check --quick` (default 20; `SUWGATE_QUICK_LIMIT` on a machine)             |
| `exceptions`             | `guard`, `target`, `reason`, optionally `message` and `once: true`; one that matches nothing fails |
| `guards.skip`            | a whole guard off, repository or .NET, with its `reason`                                           |
| `settings.<guard>`       | a guard's own settings, checked by its schema                                                      |
| `dev`                    | the local stack of `suwgate dev` ([docs/dev.md](docs/dev.md))                                      |

The schema ships in the package (`schema/suwgate.schema.json`); VS Code checks the file as you type with `yaml.schemas` in
`.vscode/settings.json`. The tool presets (`@maniumek/suwgate/eslint`, `/prettier`, `/knip`, `/vitest`, `/playwright`,
`/tsconfig/strict`, `/tsconfig/browser`, `/tsconfig/node`): [docs/usage.md](docs/usage.md#the-tool-presets).

<details>
<summary>The settings of the steps</summary>

| Step           | Setting                               | What it does                                                                                                                                                                            |
| :------------- | :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e`          | `before: [<command>, …]`              | commands run in the repository root, in order, after the database is fresh and before Playwright (clear a folder the server keeps, build what the `webServer` runs with `--no-build`)   |
| `dotnet-test`  | `excludeTraits: [live=true]`          | tests with one of these traits are outside the gate (they call a real model or service): `--filter-not-trait`, and `criteria-ran` names a criterion only they name, with the fix        |
| `api-contract` | `contract: Myapp.Server/openapi.json` | where the contract is, relative to the dotnet directory (default `contract/openapi.json`); `api-version` compares the same file and reads its version from the `package.json` beside it |
| `api-version`  | `breaking: never`                     | every breaking change fails; the default, `major`, lets one through with a new major version                                                                                            |

</details>

## Documentation

- [docs/usage.md](docs/usage.md): the gate, `suwgate.yml`, the steps and guards, the hooks, the shared rules, the presets, the .NET guards
- [docs/dev.md](docs/dev.md): `suwgate dev` and the `dev` section
- [docs/ci.md](docs/ci.md): the reusable workflows, the tree stamp, releases and Renovate
- [CHANGELOG.md](CHANGELOG.md): what each version changed, and what a repository must change with it

## Work on suwgate

[AGENTS.md](AGENTS.md) holds the rules, [docs/development.md](docs/development.md) the setup, [docs/architecture.md](docs/architecture.md)
the contract of a guard and a step, and [docs/inventory.md](docs/inventory.md) what is still to be moved here from the template and
the kits. The pictures of this README are panels of `docs/visual/board/readme.html`: edit the board, then redraw them with
`vdoc.py render docs/visual/board/readme.html` of the suwagent plugin.

## License

MIT, see [LICENSE](LICENSE).
