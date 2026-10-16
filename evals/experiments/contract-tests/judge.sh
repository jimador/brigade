#!/usr/bin/env bash
# Scores one finished run. Give it the item folder and the fixture copy the agent
# worked in. It runs the agent's test file (the path in the item's test-file file)
# against the finished source, which must pass, and then once against each mutant in
# the item's mutants folder. A mutant is killed when the test file fails on it.
# Prints one line: "<item> valid=<0|1> killed=<k> total=<n>", plus one line per
# surviving mutant. Exits 0 unless the kit itself is broken.
set -u
item_dir=$(CDPATH= cd -- "$1" && pwd) || exit 2
work=$(CDPATH= cd -- "$2" && pwd) || exit 2
kit=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
item=$(basename -- "$item_dir")
test_file=$(cat "$item_dir/test-file")

scratch=$(mktemp -d "${TMPDIR:-/tmp}/contract-judge.XXXXXX") || exit 2
trap 'rm -rf "$scratch"' EXIT

total=0
for m in "$item_dir"/mutants/*.json; do total=$((total + 1)); done

if [ ! -f "$work/$test_file" ]; then
  echo "$item valid=0 killed=0 total=$total (no $test_file)"
  exit 0
fi

# A clean copy of the fixture source with the agent's test file and nothing else of
# theirs, so a change the agent made to src/ cannot weaken or help the judgment.
clean="$scratch/clean"
mkdir "$clean"
(cd "$clean" && bash "$kit/fixture.sh") >/dev/null 2>&1 || { echo "judge: fixture failed" >&2; exit 2; }
mkdir -p "$clean/$(dirname -- "$test_file")"
cp "$work/$test_file" "$clean/$test_file"

if ! (cd "$clean" && node --test "$test_file") >/dev/null 2>&1; then
  echo "$item valid=0 killed=0 total=$total (test file fails on the finished source)"
  exit 0
fi

killed=0
survivors=""
for m in "$item_dir"/mutants/*.json; do
  copy="$scratch/$(basename -- "$m" .json)"
  cp -R "$clean" "$copy"
  node "$kit/mutate.js" "$m" "$copy" || exit 2
  if (cd "$copy" && node --test "$test_file") >/dev/null 2>&1; then
    survivors="$survivors $(basename -- "$m" .json)"
  else
    killed=$((killed + 1))
  fi
done
echo "$item valid=1 killed=$killed total=$total"
for s in $survivors; do echo "  survived $s"; done
