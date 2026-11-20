# TODO

- Move the guards and steps of [docs/inventory.md](docs/inventory.md) here, in the work packages it lists: until then the template
  and suwfrontkit keep their own gates, and two copies of a rule drift apart.
- Reusable CI workflows (GitHub Actions `workflow_call` workflows or composite actions) that the repositories call instead of each
  copying its own ci.yml, so a pinned action, a tool version or a checksum changes in one place. Do it with the migration of the
  template, suwfrontkit and suwstockdrill to suwgate, when their CI is rewritten anyway.
- Contract checks as profile steps: the API contract is up to date with the server, it changes in a breaking way only with a new
  major version, and the TypeScript types match it (today the template's api-diff and contracts scripts, run by its gate). The core
  can already run them as steps; what is missing are the steps themselves and the profile that brings them (work package C of
  the inventory). The runtime halves (generating the contract and the types) stay in the kits.
- Suwgate.Testing (NuGet): a PostgreSQL Testcontainers fixture, helpers for characterization tests and for e2e tests with
  Playwright, so that every backend tests against a real database the same way instead of copying the template's test database
  code. Do it after the backend inventory, which decides what of it belongs to suwbackkit instead.
- A dependency-direction guard: a repository with the profile `library` must not depend at runtime on an application's packages,
  and suwgate depends on none of the kits (suwfrontkit, suwbackkit), so a library never pulls an app in and the gate never needs
  the code it checks.
- `suwgate dev` (the local database, logs, smoke test and the tmux layout of the template's dev scripts), only if those scripts
  start to drift between repositories; until then they stay copies in each repository, which costs less than a shared command.
- How a repository without Node (a .NET-only one) runs the CLI: `pnpm dlx @maniumek/suwgate@<version>`, a global install, or a
  pinned version in `suwgate.yml`. Decide before the first such repository switches.
- Publish `Suwgate.Architecture` and `Suwgate.Database` to nuget.org (trusted publishing from CI), after the first application uses
  them from the packages `just pack` builds.
- Acceptance criteria (the template's criteria script with the pinned vdoc.py) as a step of every profile, once suwgate has its
  first spec.
