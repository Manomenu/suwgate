#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
usage: runner-switch.sh [status | job-started | job-completed] [--repositories <name,name,...>] [--owner <login>] [--included <minutes>] [--margin <minutes>] [--label <label>]

Moves the CI of an account's private repositories onto self-hosted runners while the account's included
GitHub Actions minutes are used up, and back onto GitHub-hosted runners when they are not (a new month).

It sums this month's Actions minutes of the owner's private repositories from the billing usage API
(GET /users/{owner}/settings/billing/usage), each minute weighed by its price against a Linux 2-core minute
(0.006 USD), since the included usage is a dollar amount spent at each runner's rate. When the sum reaches
the included minutes less the margin, it sets the repository variable CI_RUNNER=<label> on each listed
repository; otherwise it deletes CI_RUNNER where it holds <label>. The workflows read it as
runs-on: ${{ vars.CI_RUNNER || 'ubuntu-24.04' }}.

Idempotent: it changes only what differs and prints one line per change, nothing otherwise.
A listed repository that is not private is refused: a self-hosted runner must never serve a public one.

  job-started      the runner's job-started hook: hold ci-job-awake@<repository of GITHUB_REPOSITORY>, a lock that keeps
                   the machine from sleeping until job-completed or 6 hours; never fails the job
  job-completed    the runner's job-completed hook: release that lock
  status           change nothing, print one screen: the private Actions minutes of this month against the included
                   ones, CI_RUNNER of each listed repository and where its CI runs, each runner's user service
                   actions-runner@<repository> and whether its runner is busy with a job, and the switch timer's
                   last result and next run
  --repositories   the repositories to switch, comma-separated names of the owner's repositories (default: REPOSITORIES
                   in ~/.config/suw-ci-runner-switch.env, the file the systemd units read)
  --owner          the account (default: the login of gh)
  --included       the included minutes a month (default 2000: GitHub Free's 12 USD at 0.006 USD a minute)
  --margin         switch this many minutes before the included ones are used up (default 20)
  --label          the label of the self-hosted runners (default suw-local)

Needs gh, logged in with the repo and user scopes.
USAGE
}

readonly VARIABLE=CI_RUNNER
readonly LINUX_MINUTE_PRICE=0.006

readonly SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/suw-ci-runner-switch.env"
readonly SWITCH_UNIT=suw-ci-runner-switch

command=switch
keep_awake() {
    local unit="ci-job-awake@${GITHUB_REPOSITORY#*/}.service"
    if [ "$1" = job-started ]; then
        systemctl --user start "$unit" || echo "could not keep the machine awake for this job: see journalctl --user -u $unit" >&2
    else
        systemctl --user stop "$unit" || true
    fi
}

owner=""
repositories=""
included=2000
margin=20
label=suw-local

while [ $# -gt 0 ]; do
    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
        status)
            command=status
            shift
            ;;
        job-started | job-completed)
            keep_awake "$1"
            exit 0
            ;;
        --repositories | --owner | --included | --margin | --label)
            [ $# -ge 2 ] && [ -n "$2" ] || {
                echo "$1 needs a value" >&2
                exit 2
            }
            declare "${1#--}=$2"
            shift 2
            ;;
        *)
            usage >&2
            exit 2
            ;;
    esac
done

[ -n "$repositories" ] || [ ! -f "$SETTINGS" ] || repositories="$(sed -n 's/^REPOSITORIES=//p' "$SETTINGS" | tail -n 1)"
[ -n "$repositories" ] || {
    echo "no repositories: pass --repositories app1,app2, or set REPOSITORIES=app1,app2 in $SETTINGS" >&2
    exit 2
}
[[ "$included" =~ ^[0-9]+$ && "$margin" =~ ^[0-9]+$ ]] || {
    echo "--included and --margin take whole minutes" >&2
    exit 2
}
[ -n "$owner" ] || owner="$(gh api user --jq .login)"

private_repositories="$(gh repo list "$owner" --visibility private --limit 1000 --json name --jq '[.[].name]')"

used_minutes() {
    gh api "/users/$owner/settings/billing/usage?year=$(date -u +%Y)&month=$(date -u +%-m)" --jq "
        [.usageItems[]
            | select(.product == \"actions\" and .unitType == \"Minutes\" and (.repositoryName | IN(${private_repositories}[])))
            | .quantity * .pricePerUnit / $LINUX_MINUTE_PRICE]
        | add // 0 | round"
}

current_value() {
    gh api --paginate "repos/$owner/$1/actions/variables" --jq ".variables[] | select(.name == \"$VARIABLE\") | .value"
}

is_private() {
    [[ "$private_repositories" == *"\"$1\""* ]]
}

runner_on_github() {
    gh api "repos/$owner/$1/actions/runners" --jq "
        [.runners[] | select(any(.labels[]; .name == \"$label\"))
            | \"\\(.name) \\(.status)\\(if .busy then \", running a job\" else \", idle\" end)\"]
        | if length == 0 then \"no runner with the label $label\" else join(\"; \") end"
}

service_state() {
    systemctl --user show "$1" -p ActiveState -p SubState --value 2>/dev/null | paste -sd/ - || echo unknown
}

awake_line() {
    local name held=()
    for name in "${names[@]}"; do
        [ "$(systemctl --user is-active "ci-job-awake@$name.service" 2>/dev/null)" = active ] && held+=("$name")
    done
    echo "kept awake for a job: ${held[*]:-none}"
}

timer_line() {
    local last next result status
    last="$(systemctl --user show "$SWITCH_UNIT.service" -p ExecMainExitTimestamp --value 2>/dev/null)"
    next="$(systemctl --user show "$SWITCH_UNIT.timer" -p NextElapseUSecRealtime --value 2>/dev/null)"
    result="$(systemctl --user show "$SWITCH_UNIT.service" -p Result --value 2>/dev/null)"
    status="$(systemctl --user show "$SWITCH_UNIT.service" -p ExecMainStatus --value 2>/dev/null)"
    [[ -n "$status" && "$status" != 0 ]] && result=failed
    echo "switch timer $SWITCH_UNIT.timer ($(service_state "$SWITCH_UNIT.timer")): last run ${last:-never} (${result:-unknown}, exit ${status:-?}), next run ${next:-none}"
}

show_status() {
    local state where value
    state="switch point $threshold not reached: CI on GitHub-hosted runners"
    [ "$used" -ge "$threshold" ] && state="switch point $threshold reached: CI on the local runners"
    echo "private Actions minutes of $owner in $(date -u +%Y-%m): $used of $included included ($state)"
    echo
    printf '%-20s %-11s %-8s %-42s %s\n' repository CI_RUNNER runs-on service "runner on GitHub"
    for name in "${names[@]}"; do
        if ! is_private "$name"; then
            printf '%-20s %s\n' "$name" "not a private repository of $owner: the switch leaves it alone"
            continue
        fi
        value="$(current_value "$name")"
        where=GitHub
        [ -n "$value" ] && where=local
        printf '%-20s %-11s %-8s %-42s %s\n' "$name" "${value:--}" "$where" \
            "actions-runner@$name $(service_state "actions-runner@$name.service")" "$(runner_on_github "$name")"
    done
    echo
    awake_line
    timer_line
}

switch() {
    local current status=0
    for name in "${names[@]}"; do
        if ! is_private "$name"; then
            echo "$owner/$name: not a private repository of $owner, left alone: a self-hosted runner must never serve a public one" >&2
            status=1
            continue
        fi
        current="$(current_value "$name")"
        if [ "$used" -ge "$threshold" ]; then
            [ "$current" = "$label" ] && continue
            if [ -z "$current" ]; then
                gh api --silent --method POST "repos/$owner/$name/actions/variables" -f name="$VARIABLE" -f value="$label"
            else
                gh api --silent --method PATCH "repos/$owner/$name/actions/variables/$VARIABLE" -f value="$label"
            fi
            echo "$owner/$name: $VARIABLE=$label, private Actions minutes this month $used of $included"
        elif [ "$current" = "$label" ]; then
            gh api --silent --method DELETE "repos/$owner/$name/actions/variables/$VARIABLE"
            echo "$owner/$name: $VARIABLE deleted, back on GitHub-hosted runners, private Actions minutes this month $used of $included"
        fi
    done
    return "$status"
}

used="$(used_minutes)"
threshold=$((included - margin))
IFS=',' read -r -a names <<<"$repositories"

if [ "$command" = status ]; then
    show_status
else
    switch
fi
