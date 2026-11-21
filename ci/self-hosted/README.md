# Self-hosted fallback for private repositories

GitHub Free includes 12 USD of Actions compute a month for private repositories, 2,000 minutes on standard Linux runners at
0.006 USD a minute; public repositories run free. When the private repositories have used it up, GitHub refuses their jobs
until the month ends. This folder moves those jobs onto self-hosted runners on the owner's machine for the rest of the month,
and back onto GitHub-hosted runners when the new month starts. Self-hosted runners cost no included minutes.

Docs this rests on (docs.github.com): "Adding self-hosted runners", "Configuring the self-hosted runner application as a service",
"Self-hosted runners" (a runner of a personal account's repository serves that one repository), "Secure use reference" (hardening
for self-hosted runners), "Choosing the runner for a job" (`runs-on`), "Contexts reference" (`vars` in `runs-on` and in `with`,
`runner.environment`), "Reuse workflows", "REST API endpoints for billing usage" and "REST API endpoints for GitHub Actions
variables", "GitHub Actions billing".

## How it decides

- Every job of a repository that takes part runs on `${{ vars.CI_RUNNER || 'ubuntu-24.04' }}` and passes the same to suwgate's
  reusable workflows as the input `runs-on`. With no repository variable `CI_RUNNER` nothing changes.
- `runner-switch.sh` (run by the timer every 15 minutes) sums this month's Actions minutes of the account's private
  repositories from the billing usage API, each minute weighed by its price against a Linux minute (a Windows minute counts
  0.010 / 0.006, a macOS minute 0.062 / 0.006). At 1,980 of 2,000 (`--included`, `--margin`) it sets `CI_RUNNER=suw-local` on
  the listed repositories; below, it deletes `CI_RUNNER` where it holds `suw-local`. It changes only what differs and logs one
  line per change. It refuses a repository that is not private: a self-hosted runner must never run a public repository's
  pull requests.
- A job that starts while `CI_RUNNER` is set waits for the repository's runner with the label `suw-local`; it runs only while
  the machine is awake, and a suspend in the middle of a job loses it (rerun it).

## Where it stands

`just ci-runner-status` (`runner-switch.sh status`) changes nothing and prints one screen: this month's private Actions minutes
against the included ones and whether the switch point is reached; for each repository of
`~/.config/suw-ci-runner-switch.env`, its `CI_RUNNER` and whether its CI runs locally or on GitHub, the state of its user service
`actions-runner@<repository>` and its runner as GitHub sees it (online or offline, idle or running a job); and the switch timer's
last result and next run.

```text
private Actions minutes of owner in 2026-11: 2000 of 2000 included (switch point 1980 reached: CI on the local runners)

repository           CI_RUNNER   runs-on  service                                    runner on GitHub
app1                 suw-local   local    actions-runner@app1 active/running         host-app1 online, idle
app2                 suw-local   local    actions-runner@app2 active/running         host-app2 online, running a job

switch timer suw-ci-runner-switch.timer (active/waiting): last run Fri 2026-11-20 17:25:59 CET (success, exit 0), next run Fri 2026-11-20 17:30:00 CET
```

## What runs on the machine

- One runner per repository in `~/.local/share/actions-runner/<repository>`, registered with the labels `self-hosted`, `Linux`,
  `X64` and `suw-local`, each a systemd user service `actions-runner@<repository>.service` (the template
  `actions-runner@.service` of this folder). It starts `bin/runsvc.sh`, as the unit `svc.sh` writes does: it turns systemd's
  SIGTERM into the SIGINT the listener stops on, and restarts the listener after the runner's own updates; `run.sh` would leave
  the listener running when the service stops.
- Each runner has its own `HOME` (`<runner>/home`), so the toolchains the workflows install (.NET through `DOTNET_INSTALL_DIR`,
  pnpm, the Playwright browser, the NuGet and pnpm caches) never touch the owner's home. Its `PATH` is the systemd user
  manager's (`systemctl --user show-environment`), written to the runner's `.path` too, so a job finds the tools installed for
  the user, such as uv, which a gate step uses to fetch its Python. Docker is the owner's rootless podman, through `DOCKER_HOST`
  and `CONTAINER_HOST` on the podman socket.
- `suw-ci-runner-switch.timer` and `.service`, user units that run `runner-switch.sh` from the owner's checkout of suwgate
  (`~/repos/suwgate`, on `master`) with the repositories named in `~/.config/suw-ci-runner-switch.env`.
- User services run only while the owner is logged in, unless lingering is on: `loginctl show-user "$USER" -p Linger`, and
  `loginctl enable-linger "$USER"` to turn it on.

## Awake while a job runs

A job only finishes while the machine is awake: a laptop that suspends, or closes its lid, loses the job. The runner's job hooks
(`ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` in its `.env`, docs.github.com "Running scripts before
or after a job") are two-line scripts in the runner's folder that call `runner-switch.sh job-started` and `job-completed`, which
start and stop the user service `ci-job-awake@<repository>`, which holds a systemd-inhibit lock on sleep, idle and
the lid switch. Between jobs nothing is held and the machine sleeps as usual. The lock ends after 6 hours, the longest a job may
run, and when the runner's service stops, so a job cancelled without its completed hook cannot keep the machine awake for good.
`systemd-inhibit --list` shows the lock; `status` names the repositories it is held for.

## What a job shares with the owner

The runner is the owner's user on the owner's machine. suwgate's gate on it behaves as `suwgate check` run by hand in the main
checkout: its `database-up` step (`suwgate dev db up`) finds the owner's running development database (the compose project is
named in `compose.yaml`) and the tests make their own databases in it. So a gate run by hand in the main checkout at the same
time as a CI job of the same repository can collide (same test databases, same e2e ports); worktrees have their own. A job that
starts a whole container stack must give it its own compose project and no host ports the development stack holds, or its
`down --volumes` would remove the owner's development database: `suwgate dev smoke --ci` (the `smoke` input of `gate.yml`) runs the
stack as the compose project `<dev.name>-ci` with the image tag `ci` and moves every published port to a free loopback port.

Only the owner can push to these repositories. Do not add a runner to a repository that takes pull requests from others.

## Setting it up

1. Download the runner and check it against the SHA-256 on its release page (github.com/actions/runner/releases):

    ```sh
    version=2.338.2
    mkdir -p ~/.local/share/actions-runner/download && cd ~/.local/share/actions-runner/download
    curl -sSfLO "https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-x64-$version.tar.gz"
    echo "<sha256 from the release page>  actions-runner-linux-x64-$version.tar.gz" | sha256sum --check
    ```

2. For each repository, unpack, register and start a runner (the registration token lasts an hour and stays in the shell):

    ```sh
    repository=<name>
    dir=~/.local/share/actions-runner/$repository
    mkdir -p "$dir/home" && tar -xzf ~/.local/share/actions-runner/download/actions-runner-linux-x64-$version.tar.gz -C "$dir"
    token="$(gh api -X POST "repos/<owner>/$repository/actions/runners/registration-token" --jq .token)"
    (cd "$dir" && ./config.sh --unattended --url "https://github.com/<owner>/$repository" --token "$token" \
        --name "$(hostname)-$repository" --labels suw-local --work _work --replace)
    systemctl --user show-environment | sed -n 's/^PATH=//p' > "$dir/.path"
    for hook in job-started job-completed; do
        printf '#!/bin/sh\nexec %s %s\n' "$PWD/runner-switch.sh" "$hook" > "$dir/$hook.sh" && chmod +x "$dir/$hook.sh"
    done
    printf 'ACTIONS_RUNNER_HOOK_JOB_STARTED=%s\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' \
        "$dir/job-started.sh" "$dir/job-completed.sh" >> "$dir/.env"
    install -Dm644 ci-job-awake@.service ~/.config/systemd/user/ci-job-awake@.service
    install -Dm644 actions-runner@.service ~/.config/systemd/user/actions-runner@.service
    systemctl --user daemon-reload && systemctl --user enable --now "actions-runner@$repository"
    ```

3. The switch:

    ```sh
    printf 'REPOSITORIES=<name>,<name>\nOPTIONS=\nPATH=%s\n' "$(systemctl --user show-environment | sed -n 's/^PATH=//p')" \
        > ~/.config/suw-ci-runner-switch.env
    install -m644 suw-ci-runner-switch.service suw-ci-runner-switch.timer ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now suw-ci-runner-switch.timer
    ```

    The file pins `PATH` because, with linger, the user manager starts at boot before the login that adds the owner's
    tool folders to its environment, and the first run would not find `gh`.

    `OPTIONS=--included 3000` in the same file passes more options; `just ci-runner-switch` runs it by hand (with the
    repositories of that file unless `--repositories` names others), `journalctl --user -u suw-ci-runner-switch` shows what it
    changed.

4. In each repository's workflows, every job gets `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-24.04' }}`, and every call of
   suwgate's workflows gets the same expression as the input `runs-on` under `with:`.

## Removing it

```sh
systemctl --user disable --now suw-ci-runner-switch.timer
rm ~/.config/systemd/user/suw-ci-runner-switch.{service,timer} ~/.config/suw-ci-runner-switch.env
for dir in ~/.local/share/actions-runner/*/config.sh; do
    dir="${dir%/config.sh}"; repository="${dir##*/}"
    systemctl --user disable --now "actions-runner@$repository"
    token="$(gh api -X POST "repos/<owner>/$repository/actions/runners/remove-token" --jq .token)"
    (cd "$dir" && ./config.sh remove --token "$token")
    gh variable delete CI_RUNNER --repo "<owner>/$repository" || true
done
rm ~/.config/systemd/user/actions-runner@.service && systemctl --user daemon-reload
rm -rf ~/.local/share/actions-runner
```

The workflows may keep their `vars.CI_RUNNER ||` expressions: with no variable they run on GitHub.
