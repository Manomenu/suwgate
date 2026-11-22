#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ]; then
    cat <<'HELP'
Checks the version holds of the Renovate preset: every packageRule of renovate/default.json with allowedVersions is listed in
renovate/holds.json, and its range is the peer range the latest release of the package it follows declares for it (for
typescript: what typescript-eslint accepts). Fails with the range to set when that package moved its peer range, so a hold is
lifted or moved the week its reason changes, not when someone remembers. Needs jq and npm. Exit code 0 all holds current, 1 not.
HELP
    exit 0
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/renovate/default.json"
HOLDS="$ROOT/renovate/holds.json"
failed=0

held="$(jq -r '.packageRules[] | select(.allowedVersions != null) | .matchPackageNames[]' "$PRESET" | sort)"
listed="$(jq -r '.[].package' "$HOLDS" | sort)"
if [ "$held" != "$listed" ]; then
    echo "::error::renovate/default.json holds [$(echo $held)] but renovate/holds.json lists [$(echo $listed)]: give every allowedVersions rule an entry in holds.json with the package whose peer range it follows, or delete the rule"
    failed=1
fi

while IFS=$'\t' read -r package follows; do
    wanted="$(npm view "$follows@latest" "peerDependencies.$package")"
    current="$(jq -r --arg package "$package" '.packageRules[] | select(.matchPackageNames == [$package]) | .allowedVersions' "$PRESET")"
    if [ -z "$wanted" ]; then
        echo "::error::$follows no longer declares a peer range for $package: delete the hold of $package from renovate/default.json and renovate/holds.json"
        failed=1
    elif [ "$wanted" != "$current" ]; then
        echo "::error::$follows@latest accepts $package \"$wanted\", the hold in renovate/default.json is \"$current\": set allowedVersions of $package to \"$wanted\""
        failed=1
    else
        echo "$package: \"$current\", as $follows@latest accepts"
    fi
done < <(jq -r '.[] | [.package, .followsPeerRangeOf] | @tsv' "$HOLDS")
exit "$failed"
