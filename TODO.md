# TODO

- Move the guards and steps of [docs/inventory.md](docs/inventory.md) here, in the work packages it lists: until then the template
  and suwfrontkit keep their own gates, and two copies of a rule drift apart.
- Reusable CI workflows (GitHub Actions `workflow_call` workflows or composite actions) that the repositories call instead of each
  copying its own ci.yml, so a pinned action, a tool version or a checksum changes in one place. Do it with the migration of the
  template, suwfrontkit and suwstockdrill to suwgate, when their CI is rewritten anyway.
- Suwgate.Testing (NuGet): a PostgreSQL Testcontainers fixture, helpers for characterization tests and for e2e tests with
  Playwright, so that every backend tests against a real database the same way instead of copying the template's test database
  code. Do it after the backend inventory, which decides what of it belongs to suwbackkit instead.
- A dependency-direction guard: a repository with the profile `library` must not depend at runtime on an application's packages,
  and suwgate depends on none of the kits (suwfrontkit, suwbackkit), so a library never pulls an app in and the gate never needs
  the code it checks.
- How a repository without Node (a .NET-only one) runs the CLI: `pnpm dlx @maniumek/suwgate@<version>`, a global install, or a
  pinned version in `suwgate.yml`. Decide before the first such repository switches.
- Publish `Suwgate.Architecture` and `Suwgate.Database` to nuget.org (trusted publishing from CI), after the first application uses
  them from the packages `just pack` builds.
