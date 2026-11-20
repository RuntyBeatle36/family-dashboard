#!/usr/bin/env bash
# Releases what's on main to every dashboard on the Stable update channel
# (the default). Run on your development machine once you've tried the
# changes on a dashboard set to the Testing channel:
#
#   bash scripts/release.sh
#
# Shows exactly which changes would go out, asks for a yes, then moves the
# GitHub `stable` branch up to `main`. Stable dashboards then see
# "Update available" within a few minutes. Nothing changes on any
# dashboard until someone there taps Update Now.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

git fetch --quiet origin main
if git ls-remote --exit-code --heads origin stable >/dev/null 2>&1; then
  git fetch --quiet origin stable
  base=origin/stable
else
  base=""   # first release: creates the stable branch
fi

if [ -n "$base" ]; then
  if ! git merge-base --is-ancestor "$base" origin/main; then
    echo "stable has changes that aren't on main. Sort that out by hand first." >&2
    exit 1
  fi
  pending=$(git log --oneline "$base..origin/main")
  if [ -z "$pending" ]; then
    echo "Nothing to release: stable is already up to date with main."
    exit 0
  fi
  echo "These changes will go out to every dashboard on the Stable channel:"
  echo
  echo "$pending" | sed 's/^/  /'
else
  echo "There's no stable branch yet. This creates it at main ($(git rev-parse --short origin/main))."
fi
echo
read -r -p "Release them? Type yes: " answer
[ "$answer" = "yes" ] || { echo "Cancelled."; exit 1; }

git push origin origin/main:refs/heads/stable
echo "Released. Stable dashboards will offer the update within about 5 minutes."
