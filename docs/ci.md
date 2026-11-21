# CI: reusable workflows

A repository calls these workflows instead of copying a `ci.yml`, so a pinned action, a tool version or a checksum changes in one place.
They are `workflow_call` workflows in `.github/workflows/` of this repository.

| Workflow            | Does                                                                                                                                                                                                                                                                                                                     | Inputs                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `gate.yml`          | `proof` (has this push's tree already passed?), then the gate: checkout, pnpm, Node, .NET when there is a `global.json`, the browser, gitleaks and shellcheck (and oasdiff when an `openapi.json` is tracked) with checksums, `suwgate check`; the stack smoke test when asked; `stamp`; on failure keeps `gate-failure` | `runs-on`, `command`, `node-version`, `working-directory`, `browser`, `smoke`, `smoke-env`, `failure-artifacts` |
| `release-npm.yml`   | changesets: select the mode, open the "Version Packages" pull request, or build and pack; outputs `mode` and `pack-dir-artifact-id`                                                                                                                                                                                      | `runs-on`, `node-version`, `build-command`                                                                      |
| `release-nuget.yml` | checkout with the full history and tags, `dotnet pack` in Release with the SDK of `global.json`, keeps the packages as the artifact `nupkg`                                                                                                                                                                              | `runs-on`, `pack-target`                                                                                        |

Inputs exist only for what differs between repositories and cannot be read from the repository. Everything else (timeouts, action
pins, tool versions) is fixed here. `gate.yml` derives the rest: the runner is `runs-on`, else the caller's repository variable
`CI_RUNNER` ([self-hosted fallback](#self-hosted-fallback)), else `ubuntu-24.04`; the command is `suwgate check --verbose` from the
`node_modules` of `working-directory`; the .NET SDK comes with a `global.json`, oasdiff with a tracked `openapi.json`; the gate's own
`database-up` step starts the database, in CI as on a laptop (`suwgate dev db up` with a `dev` section, which runs `dev.database.up`
where a repository has its own script). The inputs `dotnet`, `oasdiff`, `database`, `database-command`, `browser-install-command`
and `browser-deps-command` still work in this release, so the callers move one by one, and go in the next minor release.

`gate.yml` outputs `proven`: `true` when the push's tree had already passed and the gate was skipped.

## Full history for the gate

`gate.yml` checks out with `fetch-depth: 0`, so `origin/master` and the merge-base exist in the runner. Guards that compare against
master (`migrations-unchanged`, the changed-files steps) pass silently when there is no master ref, so a shallow checkout would make
them check nothing in CI. A caller must not replace this checkout, and a repository that copies the gate into its own workflow must keep
the full history.

## The tree stamp: a push of a tree that already passed skips the gate

A merge to `master` usually pushes exactly the tree the pull request's last run tested: a `pull_request` run checks out the merge
preview (GitHub: `GITHUB_SHA` is "the last merge commit of the pull request merge branch"), and when master did not move after that
run, the merge commit has the same tree. Running the gate again on it proves nothing new.

- `stamp`, the last job, runs after a green run: the gate passed, and the smoke test too where it is asked for. It sets the commit
  status `ci/tree` with the tested tree (`git rev-parse HEAD^{tree}`) as its description: on a pull request on the head commit, on a
  push on the pushed commit. A failed or cancelled run writes nothing.
- `proof`, the first job, runs on every event and checks the API only (a few seconds). On a push it reads the tree of the pushed
  commit and looks for a green `ci/tree` stamp of the same tree: first on the commit itself (a tag on a commit master already
  passed, a rerun), then on the head of the merged pull request that brought the commit
  (`GET /repos/{r}/commits/{sha}/pulls`). Only an equal tree counts; on a pull request nothing is proven.
- `gate` and the smoke test run unless `proof` says `proven`. Any doubt runs them: a failing API call, a direct push, a merge
  after master moved (another tree), a fork's pull request (its token cannot write the stamp), the "Version Packages" commit when its
  pull request had no green run.
- Release jobs of the callers (`release`, `pack`, `publish`, an image push) do not look at `proven`: they need `gate`, and a job that
  is skipped inside a called workflow leaves the call green (tested once: suwstockdrill#9).

The caller's gate job must grant what these jobs use, or the workflow does not start: `contents: read`, `statuses: write` and
`pull-requests: read`.

## Superseded pull request runs are cancelled

`gate` and `stack` carry a job-level `concurrency`: on a pull request the group is the pull request's ref and a new push cancels the
running job; on a push or a tag the group is the run itself, so master and release runs are never cancelled and never wait for each
other (GitHub cancels an older pending job of a group even with `cancel-in-progress: false`). A caller needs no `concurrency`
block of its own. Tested once in a called workflow: suwstockdrill#9.

## The stack smoke test

`smoke: true` builds the images of the compose file and smoke-tests the running stack with `suwgate dev smoke --ci` ([dev.md](dev.md)):
its own compose project `<dev.name>-ci`, the image tag `ci`, every published port moved to a free loopback port, the logs on failure
and `down --volumes` at the end. On a GitHub-hosted runner it is the job `stack`, beside `gate`, so a run takes the longer of the two,
not their sum; on a self-hosted runner, where jobs of a repository run one after the other anyway, it is the last step of `gate`, after
the gate passed, so a red gate costs no image build. `smoke-env` hands the stack variables it needs, one `NAME=value` per line (a model
the server must name and never calls, for example). The registry push of a repository's images stays in its own `ci.yml`.

## The "Version Packages" pull request

The pull request that `release-npm.yml` opens is created with the workflow's `GITHUB_TOKEN`, and GitHub documents that such a pull
request's `opened` and `synchronize` "create workflow runs that require approval" (Events that trigger workflows, `pull_request`).
A run nobody approves expires as a failure without jobs when the pull request is merged; no trigger or permission in the workflow can
avoid it, because the approval comes before any job's `if`. Approve the run on the pull request page before merging: its green run
stamps the tree, so the push after the merge is proven and the release jobs start at once.

## Full history for a NuGet release

`release-nuget.yml` checks out with `fetch-depth: 0` as well (actions/checkout: "0 indicates all history for all branches and tags"),
so a version read from git tags, such as MinVer's in suwbackkit, is the tag's and never the shallow clone's `0.0.0-alpha.0`.

## Trusted publishing inside a reusable workflow

The question: the publish happens in a workflow of another repository, so which workflow does the registry see?

- GitHub: the OIDC token carries `job_workflow_ref` (the called workflow, here suwgate's file) and `workflow_ref` (the caller's). A job
  of a called workflow must be granted `id-token: write` by the caller job, because permissions can only be kept or reduced, never raised.
  Re-read on 2026-11-21: npm's page still names the caller's workflow, and nuget.org's page (updated 2026-09-01) still says nothing
  about reusable workflows, so the decision below stands.

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
a secret (both registries use OIDC). Callers set `permissions` per job: `contents: read`, `statuses: write` and
`pull-requests: read` for the gate; `contents: write` and `pull-requests: write` for `release-npm.yml`.

## Callers

An app (Playwright, .NET, PostgreSQL and a compose stack; the `config-contents` guard asks for this call, pinned by the full sha). This
is its whole `ci.yml`:

```yaml
name: ci

on:
    push:
        branches: [master]
    pull_request:

permissions: {}

jobs:
    gate:
        permissions:
            contents: read
            statuses: write
            pull-requests: read
        uses: Manomenu/suwgate/.github/workflows/gate.yml@<sha>
        with:
            working-directory: Myapp.Web
            browser: chromium
            smoke: true
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

A NuGet package (suwbackkit, versioned by MinVer from its `v*` tags), triggered by a version tag, the gate first, with the
trusted-publishing policy naming the caller's file and the environment:

```yaml
on:
    push:
        branches: [master]
        tags: ["v*"]
    pull_request:

jobs:
    gate:
        permissions:
            contents: read
            statuses: write
            pull-requests: read
        uses: Manomenu/suwgate/.github/workflows/gate.yml@<sha>

    pack:
        if: startsWith(github.ref, 'refs/tags/v')
        needs: gate
        permissions:
            contents: read
        uses: Manomenu/suwgate/.github/workflows/release-nuget.yml@<sha>
        with:
            pack-target: Suwbackkit.slnx

    publish:
        if: startsWith(github.ref, 'refs/tags/v') && vars.NUGET_USER != ''
        needs: pack
        runs-on: ubuntu-24.04
        environment: nuget-org
        permissions:
            contents: read
            id-token: write
        steps:
            - uses: actions/download-artifact@<sha>
              with:
                  name: nupkg
                  path: nupkg
            - uses: actions/setup-dotnet@<sha>
              with:
                  dotnet-version: 10.0.x
            - name: A tag publishes its own version only, never a pre-release built between tags
              env:
                  TAG: ${{ github.ref_name }}
              run: |
                  set -euo pipefail
                  shopt -s nullglob
                  packages=(nupkg/*.nupkg)
                  [ "${#packages[@]}" -gt 0 ] || { echo "no .nupkg in the artifact" >&2; exit 1; }
                  for package in "${packages[@]}"; do
                    case "$package" in *."${TAG#v}".nupkg) ;; *) echo "$package does not carry the tag's version" >&2; exit 1 ;; esac
                  done
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

## Self-hosted fallback

A private repository of a GitHub Free account gets 2,000 Linux minutes a month (12 USD at 0.006 USD a minute); once they are
used up, GitHub refuses its jobs until the month ends. The fallback moves those jobs onto self-hosted runners on the owner's
machine meanwhile. `gate.yml` runs every job on `${{ inputs.runs-on || vars.CI_RUNNER || 'ubuntu-24.04' }}`, and GitHub's
variables reference says "For reusable workflows, the variables from the caller workflow's repository are used", so a caller passes
nothing: the repository variable `CI_RUNNER` moves its gate. A job of the caller's own uses the same expression in its `runs-on`.
`release-npm.yml` and `release-nuget.yml` still take `runs-on` (default `ubuntu-24.04`); only the public kits call them. With no
variable `CI_RUNNER` nothing changes. The switch that sets and deletes it from the account's billing usage, the systemd
units and the setup of the runners are in [ci/self-hosted](../ci/self-hosted/README.md).

So that `gate.yml` runs on a self-hosted Linux runner that is not Ubuntu and has no sudo:

- gitleaks, shellcheck and oasdiff go into `bin/` of the runner's temp folder, which the step adds to the `PATH` of the job, not
  into `/usr/local/bin` with sudo;
- `browser: chromium` runs `playwright install-deps chromium` only where `runner.environment` is `github-hosted`: it installs the
  system packages with apt, which a Fedora runner has not, and a self-hosted runner brings its own. `playwright install chromium`
  then installs the browser alone, into the runner's home (Playwright is the calling repository's dependency, not suwgate's, so
  `knip.json` ignores the binary `playwright` that `gate.yml` names);
- pnpm, Node and .NET come from their setup actions as on GitHub; a self-hosted runner sets `DOTNET_INSTALL_DIR` to a folder it
  may write (setup-dotnet's README: the default `/usr/share/dotnet` "may not be writable by the runner user");
- the pnpm cache of setup-node and the NuGet cache of setup-dotnet are used on GitHub-hosted runners only: a self-hosted runner
  keeps its pnpm store and NuGet packages in its home, and restoring and saving GitHub's cache there only costs time.

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
and keeps its own publish jobs (npm, and NuGet on a `nuget-v*` tag), as above. A `nuget-v*` tag on a commit whose master run passed
is proven by that run's stamp: the tag run skips the gate and packs and publishes at once.
