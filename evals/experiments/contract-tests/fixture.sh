#!/usr/bin/env bash
# Fixture for the contract-tests experiment: the acme-utils repo from the
# writing-rules kit with every item's source change applied, so all six modules are
# finished, and only the original tests. The functions the items name exist and work,
# but nothing tests them yet. Run it in an empty folder; it needs only git and node.
set -euo pipefail
kit=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
writing="$kit/../writing-rules"

bash "$writing/fixture.sh"
for patch in "$writing"/items/*/solution.patch; do
  git apply --include='src/*' "$patch"
done
git add -A
git -c user.name=alex -c user.email=alex@example.com commit -qm "finish the six modules"
