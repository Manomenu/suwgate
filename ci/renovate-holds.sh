#!/usr/bin/env bash
set -euo pipefail
usage() {
    cat <<'HELP'
The version holds of the Renovate preset: every packageRule of renovate/default.json with allowedVersions is listed in
renovate/holds.json with the package whose peer range it follows (typescript: what typescript-eslint accepts).
  renovate-holds.sh --check   every hold of the preset is listed and every listed hold is in the preset; no network (a gate step)
  renovate-holds.sh --update  sets each hold to the peer range the latest release of the package it follows declares, and deletes
                              a hold that package no longer declares a range for; prints what it changed (the renovate workflow
                              opens a pull request with it, so a hold moves the week its reason does)
Needs jq; --update also npm and the installed dependencies (it formats what it writes with the repository's prettier). Exit code 0 done, 1 the preset and holds.json disagree, 2 a usage problem.
HELP
}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DROP_HOLD='del(.packageRules[] | select(.matchPackageNames == [env.PACKAGE] and .allowedVersions != null))'
DROP_LISTED='map(select(.package != env.PACKAGE))'
SET_HOLD='(.packageRules[] | select(.matchPackageNames == [env.PACKAGE]) | .allowedVersions) = env.WANTED'
PRESET="$ROOT/renovate/default.json"
HOLDS="$ROOT/renovate/holds.json"

check() {
    local held listed
    held="$(jq -r '.packageRules[] | select(.allowedVersions != null) | .matchPackageNames[]' "$PRESET" | sort)"
    listed="$(jq -r '.[].package' "$HOLDS" | sort)"
    if [ "$held" != "$listed" ]; then
        echo "renovate-holds.sh: renovate/default.json holds [${held//$'\n'/ }] but renovate/holds.json lists [${listed//$'\n'/ }]: give every allowedVersions rule an entry in holds.json with the package whose peer range it follows, or delete the rule" >&2
        exit 1
    fi
}

write_json() {
    local file="$1" next
    shift
    next="$(jq "$@" "$file")"
    printf '%s\n' "$next" >"$file"
    "$ROOT/node_modules/.bin/prettier" --write --log-level warn "$file"
}

update() {
    local package follows wanted current
    while IFS=$'\t' read -r package follows; do
        wanted="$(npm view "$follows@latest" "peerDependencies.$package")"
        current="$(jq -r --arg package "$package" '.packageRules[] | select(.matchPackageNames == [$package]) | .allowedVersions' "$PRESET")"
        export PACKAGE="$package" WANTED="$wanted"
        if [ -z "$wanted" ]; then
            write_json "$PRESET" "$DROP_HOLD"
            write_json "$HOLDS" "$DROP_LISTED"
            echo "$package: $follows no longer declares a peer range for it, so its hold is deleted"
        elif [ "$wanted" != "$current" ]; then
            write_json "$PRESET" "$SET_HOLD"
            echo "$package: \"$current\" -> \"$wanted\", as $follows@latest accepts"
        fi
    done < <(jq -r '.[] | [.package, .followsPeerRangeOf] | @tsv' "$HOLDS")
}

case "${1:-}" in
    --check) check ;;
    --update)
        check
        update
        ;;
    --help) usage ;;
    *)
        usage >&2
        exit 2
        ;;
esac
