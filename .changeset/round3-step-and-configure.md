---
"@maniumek/suwgate": minor
---

- `suwgate step <id> [--only] [--verbose] [-- <args>]` runs one step with the steps it needs (or alone with `--only`), with the
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
