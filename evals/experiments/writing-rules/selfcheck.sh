#!/usr/bin/env bash
# Proves the kit before anyone spends model runs on it. There must be exactly six
# item folders, and for each one: a fresh fixture passes its own suite, the item's
# verify.sh fails there, solution.patch applies, and verify.sh then passes. It stops
# at the first problem with a non-zero exit and prints "ok <item>" for each item.
set -u

kit=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
items_dir="$kit/items"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

count=0
for dir in "$items_dir"/*/; do
  [ -d "$dir" ] && count=$((count + 1))
done
[ "$count" -eq 6 ] || fail "expected exactly 6 item folders in $items_dir, found $count"

work=$(mktemp -d "${TMPDIR:-/tmp}/writing-rules-selfcheck.XXXXXX") || fail "could not make a temporary folder"
trap 'rm -rf "$work"' EXIT

for dir in "$items_dir"/*/; do
  item=$(basename -- "$dir")
  dir="$items_dir/$item"
  for file in plain.md ste-80.md verify.sh solution.patch hidden.test.js; do
    [ -f "$dir/$file" ] || fail "$item: missing $file"
  done

  repo="$work/$item"
  log="$work/$item.log"
  mkdir "$repo" || fail "$item: could not make $repo"

  (cd "$repo" && bash "$kit/fixture.sh") >"$log" 2>&1 || {
    cat "$log" >&2
    fail "$item: fixture.sh failed"
  }
  # The fixture's own tests must pass, so a red verify.sh below means the item is
  # not done yet rather than a broken fixture.
  (cd "$repo" && node --test) >"$log" 2>&1 || {
    cat "$log" >&2
    fail "$item: the fresh fixture's own tests fail"
  }

  if (cd "$repo" && bash "$dir/verify.sh") >"$log" 2>&1; then
    fail "$item: verify.sh passed on a fresh fixture, so it cannot tell done from not done"
  fi

  (cd "$repo" && git apply "$dir/solution.patch") >"$log" 2>&1 || {
    cat "$log" >&2
    fail "$item: solution.patch does not apply to a fresh fixture"
  }

  (cd "$repo" && bash "$dir/verify.sh") >"$log" 2>&1 || {
    cat "$log" >&2
    fail "$item: verify.sh still fails after solution.patch"
  }
  # The reference solution must not break the rest of the suite either.
  (cd "$repo" && node --test) >"$log" 2>&1 || {
    cat "$log" >&2
    fail "$item: the full suite fails after solution.patch"
  }

  echo "ok $item"
done
