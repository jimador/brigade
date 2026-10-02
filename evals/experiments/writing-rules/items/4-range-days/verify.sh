#!/usr/bin/env bash
# Says whether this work item is done. Run it from the root of a fixture copy, with
# no arguments. It copies the item's hidden test into the copy's test folder, runs
# that one test file, and exits with the test run's status: 0 means done.
set -u
item_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
item=$(basename -- "$item_dir")
mkdir -p test || exit 2
cp "$item_dir/hidden.test.js" "test/hidden-$item.test.js" || exit 2
node --test "test/hidden-$item.test.js"
exit $?
