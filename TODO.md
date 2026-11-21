# TODO

- Move the guards and steps of [docs/inventory.md](docs/inventory.md) here, in the work packages it lists: until then the template
  and suwfrontkit keep their own gates, and two copies of a rule drift apart.
- A dependency-direction guard: a repository with the profile `library` must not depend at runtime on an application's packages,
  and suwgate depends on none of the kits (suwfrontkit, suwbackkit), so a library never pulls an app in and the gate never needs
  the code it checks.
- How a repository without Node (a .NET-only one) runs the CLI: `pnpm dlx @maniumek/suwgate@<version>`, a global install, or a
  pinned version in `suwgate.yml`. Decide before the first such repository switches.
- `suwgate criteria [id]` and `suwgate contracts [name@version]`: lookups of where a criterion is guarded and which tests pin a
  contract version, so nobody greps for them.
- A command that re-records the visual snapshots (the `visual` step's Playwright image with `--update-snapshots`).
- A consumer test with several consumers: `gate.yml` takes one `consumer` per call ([docs/ci.md](docs/ci.md)), so a kit with a second
  real consumer adds a second call or a matrix over the repositories. Do it when a kit has a second public consumer worth the CI minutes.
- The browser-storage ban of `app()` as its own ESLint export, so a repository that is not an app can use it alone.
- `dependency-direction`: a runtime check of the shipped `.csproj` files of a `dotnet` library that honours `PrivateAssets="all"`.
- Guard candidates:
    - `criterion-per-test`: every test of system logic names a criterion; the meta places (guards, fixtures) as a setting.
