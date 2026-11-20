# CI: reusable workflows

A repository calls these workflows instead of copying a `ci.yml`, so a pinned action, a tool version or a checksum changes in one place.
They are `workflow_call` workflows in `.github/workflows/` of this repository.

| Workflow            | Does                                                                                                                                                                                 | Inputs                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate.yml`          | checkout, pnpm, Node, .NET (when asked), the browser (when asked), gitleaks and shellcheck with checksums, then the gate; on failure keeps `gate-failure` (visual diffs, e2e report) | `command` (default `pnpm exec suwgate check --verbose`), `node-version`, `working-directory`, `dotnet`, `browser-install-command`, `oasdiff`, `failure-artifacts` |
| `release-npm.yml`   | changesets: select the mode, open the "Version Packages" pull request, or build and pack; outputs `mode` and `pack-dir-artifact-id`                                                  | `node-version`, `build-command`                                                                                                                                   |
| `release-nuget.yml` | `dotnet pack` in Release with the SDK of `global.json`, keeps the packages as the artifact `nupkg`                                                                                   | `pack-target`                                                                                                                                                     |

Inputs exist only for what differs between repositories. Everything else (runner, timeouts, action pins, tool versions) is fixed here.

## Full history for the gate

`gate.yml` checks out with `fetch-depth: 0`, so `origin/master` and the merge-base exist in the runner. Guards that compare against
master (`migrations-unchanged`, the changed-files steps) pass silently when there is no master ref, so a shallow checkout would make
them check nothing in CI. A caller must not replace this checkout, and a repository that copies the gate into its own workflow must keep
the full history.

## What a workflow in the same repository cannot do

`gate.yml` has no database service: a job's `services` cannot be switched on by an input. A repository whose tests need PostgreSQL
runs its tests against Testcontainers (Docker is on the runner), or keeps that job in its own `ci.yml`. The template's e2e job and
image build stay in the template for the same reason: they are project-specific.

## Trusted publishing inside a reusable workflow

The question: the publish happens in a workflow of another repository, so which workflow does the registry see?

- GitHub: the OIDC token carries `job_workflow_ref` (the called workflow, here suwgate's file) and `workflow_ref` (the caller's). A job
  of a called workflow must be granted `id-token: write` by the caller job, because permissions can only be kept or reduced, never raised.
- npm (docs.npmjs.com/trusted-publishers): for `workflow_call` setups, "validation checks the calling workflow's name instead of the
  workflow that actually contains the publish command", and `id-token: write` must be given to both the parent and the child workflow.
  So npm works from a reusable workflow, but the trusted publisher of the package must name the caller's file (for example `ci.yml` of
  the repository that owns the package), not suwgate's.
- NuGet (learn.microsoft.com/nuget/nuget-org/trusted-publishing, github.com/NuGet/login): the policy holds owner, repository, workflow file
  name and optionally an environment. Neither page says which claim is compared when the publish runs in a reusable workflow. The
  behaviour is not documented, so it is not relied on.

Decision: the publish job stays in the caller, in both cases. The reusable workflows do everything that needs no OIDC token
(select the mode, version, build, pack, keep the packages as an artifact), and the caller's `publish` job holds the three steps that
talk to the registry. The token then always names the caller's own workflow file, the trusted-publisher configuration is the one the
registry's docs show for a plain workflow, and no rule depends on undocumented behaviour. The cost is a publish job of a few lines in
every releasing repository.

## Pinning

A caller pins the reusable workflow to a commit of this repository, never to a branch:
`uses: Manomenu/suwgate/.github/workflows/gate.yml@<full commit sha>` (GitHub: "Using the commit SHA is the safest option for stability
and security"). The called workflow's own steps are pinned by commit as well. `secrets: inherit` is not used: none of the workflows needs
a secret (both registries use OIDC). Callers set `permissions` per job: `contents: read` for the gate; `contents: write` and
`pull-requests: write` for `release-npm.yml`.

## Callers

The gate (a repository with Playwright and .NET):

```yaml
jobs:
    gate:
        permissions:
            contents: read
        uses: Manomenu/suwgate/.github/workflows/gate.yml@<sha>
        with:
            dotnet: true
            browser-install-command: pnpm exec playwright install --with-deps chromium
```

An npm package (suwfrontkit): the gate, then on `master` the release and the publish job in the caller.

```yaml
release:
    if: github.event_name == 'push'
    needs: gate
    permissions:
        contents: write
        pull-requests: write
    uses: Manomenu/suwgate/.github/workflows/release-npm.yml@<sha>

publish:
    if: needs.release.outputs.mode == 'publish'
    needs: release
    runs-on: ubuntu-24.04
    permissions:
        contents: write
        id-token: write
    steps:
        - uses: actions/checkout@<sha>
          with:
              persist-credentials: false
        - uses: pnpm/action-setup@<sha>
        - uses: actions/setup-node@<sha>
          with:
              node-version: 24.22.1
              package-manager-cache: false
        - run: pnpm install --frozen-lockfile
        - uses: changesets/action/publish@<sha>
          with:
              pack-dir-artifact-id: ${{ needs.release.outputs.pack-dir-artifact-id }}
```

A NuGet package (suwbackkit), triggered by a version tag, with the trusted-publishing policy naming the caller's file:

```yaml
on:
    push:
        tags: ["v*"]

jobs:
    pack:
        permissions:
            contents: read
        uses: Manomenu/suwgate/.github/workflows/release-nuget.yml@<sha>

    publish:
        needs: pack
        runs-on: ubuntu-24.04
        permissions:
            id-token: write
        steps:
            - uses: actions/download-artifact@<sha>
              with:
                  name: nupkg
                  path: nupkg
            - uses: NuGet/login@<sha>
              id: login
              with:
                  user: ${{ vars.NUGET_USER }}
            - run: dotnet nuget push "nupkg/*.nupkg" --api-key "$NUGET_API_KEY" --source https://api.nuget.org/v3/index.json --skip-duplicate
              env:
                  NUGET_API_KEY: ${{ steps.login.outputs.NUGET_API_KEY }}
```

The pins used here: checkout v7.0.1, pnpm/action-setup v6.1.1, setup-node v7.1.0, setup-dotnet v6.0.0, upload-artifact v7.0.2,
changesets/action v2.1.2 (as in `gate.yml` and `release-npm.yml`), download-artifact v8.0.2 (`9000827ccba6bdab643e8b6fd33ac0654aef8333`),
NuGet/login v1.2.0 (`8d196754b4036150537f80ac539e15c2f1028841`).

## NuGet versions and tags

Decision: the version of the NuGet packages is the `Version` in `Directory.Build.props`, and a release is the tag `nuget-v<version>` on the
commit that carries it. The npm release has its own version (changesets, `package.json`) and its own flow, so the two cannot collide: the
tag filter of `ci.yml` is `nuget-v*`, the tags changesets creates for the CLI (`v0.1.0` or `@maniumek/suwgate@0.1.0`) never match it,
and the `release` job runs on the `master` branch only, never on a tag.

Why not MinVer with `MinVerTagPrefix=nuget-v` (the README of MinVer, github.com/adamralph/minver, supports the prefix): it needs the full
git history in every job that builds, or a shallow clone silently falls back to `0.0.0-alpha.0`; every build between tags becomes a
pre-release such as `0.1.1-alpha.0.3`, which the publish job must then refuse; and it adds a package that the lock files and
`Directory.Packages.props` must carry. With one version for two packages that move together, the props version costs one line per
release and the publish job's check (every package is named `<id>.<tag version>.nupkg`) makes a tag that disagrees with the props fail
before anything is pushed. Switch to MinVer when the packages are versioned independently.

The `publish-nuget` job runs on a `nuget-v*` tag only when the repository variable `NUGET_USER` is set, in the environment `nuget-org`,
with `id-token: write` on that job alone. A trusted-publishing policy on nuget.org names owner, repository, the workflow file name
`ci.yml` and that environment. Symbols are packed as `.snupkg` next to each package and pushed with it. The first release is described in
[first-release.md](first-release.md).

## suwgate itself

`ci.yml` calls `gate.yml` and `release-npm.yml` from the same repository (`./.github/workflows/...`, which runs at the caller's commit),
and keeps its own publish jobs (npm, and NuGet on a `nuget-v*` tag), as above.
