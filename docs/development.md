# Development

## Requirements

- Node 24 and pnpm 11 (`corepack enable`), `just`.
- The .NET 10 SDK (`global.json`; tests run on Microsoft.Testing.Platform).
- For the full gate: `shellcheck` and `gitleaks`. A missing tool is reported as SKIP (a failure in CI), and the report ends with
  `NOT VERIFIED: <steps>`.
- A POSIX shell: steps are bash commands. On Windows use Git Bash.

Once per clone: `just sync` (the git hooks, the packages from the lockfiles, CSharpier).

## Everyday commands

```sh
just                  # every recipe, grouped
just check-quick      # node src/cli.ts check --quick: the guards, and what changed
just check            # node src/cli.ts check: the whole gate, the same CI runs
just dist check       # build dist/ and run the built CLI, as npm ships it
just pack             # the .NET packages into .artifacts/nupkg
just changeset        # describe a change of src/ or schema/ for the next release
just fmt              # Prettier and CSharpier
```

suwgate checks itself: `suwgate.yml` names the profiles `library` and `dotnet`, adds a `dotnet pack` step and a start of the built CLI,
and skips `attw` with its reason. `node src/cli.ts` runs the CLI from its sources (Node strips the types), so a change is checked by
the gate it changes.

## Trying a change in another repository

In the other repository: `pnpm add -D link:../suwgate` after one `pnpm run build` here, or run
`node ../suwgate/src/cli.ts check` from its root. For the .NET packages, `just pack` and add `.artifacts/nupkg` of this repository
as a local source in that repository's `nuget.config`. Neither a `link:` nor a local source reaches its commit.

## Releases

The CLI: a changeset per change; on `master`, CI opens the "Version Packages" pull request, and after the owner merges it, publishes
`@maniumek/suwgate` with npm trusted publishing (provenance included). The .NET packages are not published yet (TODO.md).
