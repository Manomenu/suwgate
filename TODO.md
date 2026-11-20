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
- The first release of the CLI and of `Suwgate.Architecture` and `Suwgate.Database`: [docs/first-release.md](docs/first-release.md). The
  NuGet publish job is wired and waits for the owner's account, policy and tag.
- `suwgate criteria [id]` and `suwgate contracts [name@version]`: lookups of where a criterion is guarded and which tests pin a
  contract version, so nobody greps for them.
- A command that re-records the visual snapshots (the `visual` step's Playwright image with `--update-snapshots`).
- The `consumer-app` step for a library with several consumer apps.
- The browser-storage ban of `app()` as its own ESLint export, so a repository that is not an app can use it alone.
- `dependency-direction`: a runtime check of the shipped `.csproj` files of a `dotnet` library that honours `PrivateAssets="all"`.
- Guard candidates:
    - `criterion-per-test`: every test of system logic names a criterion; the meta places (guards, fixtures) as a setting.
