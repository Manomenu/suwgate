#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
usage: runner-switch.sh --repositories <name,name,...> [--owner <login>] [--included <minutes>] [--margin <minutes>] [--label <label>]

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

  --repositories   the repositories to switch, comma-separated names of the owner's repositories (required)
  --owner          the account (default: the login of gh)
  --included       the included minutes a month (default 2000: GitHub Free's 12 USD at 0.006 USD a minute)
  --margin         switch this many minutes before the included ones are used up (default 20)
  --label          the label of the self-hosted runners (default suw-local)

Needs gh, logged in with the repo and user scopes.
USAGE
}

readonly VARIABLE=CI_RUNNER
readonly LINUX_MINUTE_PRICE=0.006

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

[ -n "$repositories" ] || {
    echo "--repositories is required: name the private repositories whose CI the switch moves, e.g. --repositories app1,app2" >&2
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

used="$(used_minutes)"
threshold=$((included - margin))
status=0

IFS=',' read -r -a names <<<"$repositories"
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
exit "$status"
