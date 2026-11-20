---
"@maniumek/suwgate": patch
---

Fixes found while moving the template, suwbackkit and alfusion onto suwgate:

- `dotnet-test --quick` finds a gate project that references the guards with `<PackageReference Update="Suwgate.Architecture" />`.
- `docs-paths` reads a .NET guard id such as `architecture/layers` as a guard, not as a missing path.
- `repository-layout` reads the map only from the section `## The map` of `docs/architecture.md`, and asks for that section when it
  is missing.
- The .NET steps (`dotnet-build`, `dotnet-format`, `dotnet-test`, `api-contract`) set `MSBUILDDISABLENODEREUSE=1` and
  `DOTNET_CLI_USE_MSBUILD_SERVER=0`, so no idle MSBuild worker or build server stays behind.
- `dotnet-test` runs under `suwgate dev checkout-env` when `suwgate.yml` has a `dev` section, so two worktrees never share a test
  database.
- `no-raw-colors` leaves the tests out (`*.test.*`, `*.spec.*`, `*.e2e.*`).
- `comments-eslint` leaves out the web app's generated `src/api/openapi.d.ts`, which the `api-contract` step checks: its exception
  in `suwgate.yml` can go.
