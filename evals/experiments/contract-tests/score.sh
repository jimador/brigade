#!/usr/bin/env bash
# Scores a folder of finished runs. Each run is a folder named
# <model>-<item>-<style>-<run> (for example haiku-3-cache-ttl-contract-2) holding the
# fixture copy the agent worked in as repo/. It prints one tab-separated line per run,
# then the kill rate per model and style: mutants killed over mutants in valid runs,
# plus how many runs were invalid (no test file, or a test file that fails on the
# finished source). An invalid run kills nothing and still counts its mutants.
# Usage: score.sh <runs folder>
set -u
kit=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
runs=$(CDPATH= cd -- "${1:?usage: score.sh <runs folder>}" && pwd) || exit 2

printf 'model\titem\tstyle\trun\tvalid\tkilled\ttotal\n'
for dir in "$runs"/*/; do
  name=$(basename -- "$dir")
  model=${name%%-*}
  rest=${name#*-}
  run=${rest##*-}
  rest=${rest%-*}
  style=${rest##*-}
  item=${rest%-*}
  [ -d "$kit/items/$item" ] || continue
  line=$(bash "$kit/judge.sh" "$kit/items/$item" "$dir/repo" | head -1)
  valid=$(printf '%s\n' "$line" | sed -n 's/.*valid=\([0-9]*\).*/\1/p')
  killed=$(printf '%s\n' "$line" | sed -n 's/.*killed=\([0-9]*\).*/\1/p')
  total=$(printf '%s\n' "$line" | sed -n 's/.*total=\([0-9]*\).*/\1/p')
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$model" "$item" "$style" "$run" "$valid" "$killed" "$total"
done | tee "$runs/scores.tsv"

echo
awk -F'\t' '$1 != "model" {
  key = $1 " " $3
  killed[key] += $6; total[key] += $7; runs[key] += 1
  if ($5 == 0) invalid[key] += 1
} END {
  for (key in killed) {
    printf "%s: killed %d/%d (%.1f%%), runs %d, invalid %d\n", key, killed[key], total[key], 100 * killed[key] / total[key], runs[key], invalid[key] + 0
  }
}' "$runs/scores.tsv" | sort
