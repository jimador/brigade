#!/usr/bin/env bash
# Proves the kit before anyone spends model runs on it. For each item: both packets,
# the test-file name and at least one mutant exist; the reference test passes on the
# finished source; every mutant applies cleanly, and the reference test kills every
# mutant, so each mutant is a real behavior change that a complete test suite can see;
# the fixture's own tests still pass on each mutant, so the old suite cannot catch it
# and only new tests can. Prints "ok <item> (<n> mutants)" and stops non-zero at the
# first problem.
set -u
kit=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

work=$(mktemp -d "${TMPDIR:-/tmp}/contract-selfcheck.XXXXXX") || fail "no temporary folder"
trap 'rm -rf "$work"' EXIT
base="$work/base"
mkdir "$base"
(cd "$base" && bash "$kit/fixture.sh") >/dev/null 2>&1 || fail "fixture.sh failed"
(cd "$base" && node --test) >/dev/null 2>&1 || fail "the fixture's own tests fail"

for dir in "$kit"/items/*/; do
  item=$(basename -- "$dir")
  dir="$kit/items/$item"
  for file in plain.md contract.md test-file reference.test.js; do
    [ -f "$dir/$file" ] || fail "$item: missing $file"
  done
  test_file=$(cat "$dir/test-file")
  ref="$work/$item-ref"
  cp -R "$base" "$ref"
  cp "$dir/reference.test.js" "$ref/$test_file"
  (cd "$ref" && node --test "$test_file") >"$work/log" 2>&1 || { cat "$work/log" >&2; fail "$item: reference test fails on the finished source"; }

  n=0
  for m in "$dir"/mutants/*.json; do
    [ -f "$m" ] || fail "$item: no mutants"
    n=$((n + 1))
    name=$(basename -- "$m" .json)
    copy="$work/$item-$name"
    cp -R "$ref" "$copy"
    node "$kit/mutate.js" "$m" "$copy" || fail "$item/$name: does not apply"
    if (cd "$copy" && node --test "$test_file") >/dev/null 2>&1; then
      fail "$item/$name: the reference test does not kill it"
    fi
    rm "$copy/$test_file"
    (cd "$copy" && node --test) >"$work/log" 2>&1 || { cat "$work/log" >&2; fail "$item/$name: the fixture's own tests already catch it"; }
  done
  echo "ok $item ($n mutants)"
done
