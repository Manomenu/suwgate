---
"@maniumek/suwgate": minor
---

The reusable workflows `gate.yml`, `release-npm.yml` and `release-nuget.yml` take the input `runs-on` (default `ubuntu-24.04`, as
before) for all their jobs, so a private repository can move its CI onto self-hosted runners while the account's included Actions
minutes are used up: pass `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-24.04' }}`. `gate.yml` runs on a self-hosted Linux runner that is
not Ubuntu and has no sudo: gitleaks, shellcheck and oasdiff go into the runner's temp folder instead of `/usr/local/bin`, and the
new input `browser-deps-command` installs the browser's system packages on GitHub-hosted runners only.

What a repository changes: nothing to keep its CI as it is. To use the fallback, split
`browser-install-command: pnpm exec playwright install --with-deps chromium` into
`browser-install-command: pnpm exec playwright install chromium` and `browser-deps-command: pnpm exec playwright install-deps chromium`,
and pass `runs-on`. The switch that sets the repository variable `CI_RUNNER` from the account's billing usage, its systemd units and
the setup of the runners are in `ci/self-hosted/` of the suwgate repository (`just ci-runner-switch`).
