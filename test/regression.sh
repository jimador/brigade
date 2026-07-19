#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/brigade-regression.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

test_status_inline_items() {
  fixture="$TMP_ROOT/status-inline"
  mkdir -p "$fixture/.brigade/dishes/sample"
  cat >"$fixture/.brigade/dishes/sample/PLAN.md" <<'EOF'
---
doc: plan
ticket: TEST-1
items:
  - { slug: one, status: done, depends_on: [],
      heavy: false, files: [src/one.ts], attempts: [] }
  - { slug: two, status: blocked,
      depends_on: [one], heavy: false, files: [src/two.ts],
      attempts: [] }
---

## Dish
Regression fixture.
EOF

  json="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-status" --json)"
  python3 - "$json" <<'PY' || fail "brigade-status --json did not report wrapped inline items"
import json
import sys

document = json.loads(sys.argv[1])
items = document["dishes"][0]["items"]
expected = [
    {"slug": "one", "status": "done"},
    {"slug": "two", "status": "blocked"},
]
if items != expected:
    raise SystemExit(f"expected {expected!r}, got {items!r}")
PY

  text="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-status")"
  printf '%s\n' "$text" | grep -Fq "  one: done" ||
    fail "brigade-status text did not report inline item one"
  printf '%s\n' "$text" | grep -Fq "  two: blocked" ||
    fail "brigade-status text did not report inline item two"
  printf '%s\n' "$text" | grep -Fq "done=1" ||
    fail "brigade-status text did not total done items"
  printf '%s\n' "$text" | grep -Fq "blocked=1" ||
    fail "brigade-status text did not total blocked items"
}

test_status_block_items() {
  fixture="$TMP_ROOT/status-block"
  mkdir -p "$fixture/.brigade/dishes/sample"
  cat >"$fixture/.brigade/dishes/sample/PLAN.md" <<'EOF'
---
doc: plan
items:
  - slug: legacy
    status: in_review
---
EOF

  json="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-status" --json)"
  python3 - "$json" <<'PY' || fail "brigade-status --json lost block-style item support"
import json
import sys

items = json.loads(sys.argv[1])["dishes"][0]["items"]
expected = [{"slug": "legacy", "status": "in_review"}]
if items != expected:
    raise SystemExit(f"expected {expected!r}, got {items!r}")
PY
}

run_guard_payload() {
  payload="$1"
  stderr_file="$TMP_ROOT/guard.stderr"

  if printf '%s' "$payload" |
    CLAUDE_PROJECT_DIR="$TMP_ROOT/guard-repo" "$ROOT/hooks/guard.sh" \
      >/dev/null 2>"$stderr_file"; then
    return 0
  else
    return $?
  fi
}

run_guard() {
  command="$1"
  payload="$(python3 - "$command" <<'PY'
import json
import sys

print(json.dumps({"tool_input": {"command": sys.argv[1]}}))
PY
)"
  run_guard_payload "$payload"
}

assert_guard_blocks() {
  command="$1"
  if run_guard "$command"; then
    fail "guard allowed: $command"
  else
    status=$?
  fi
  [ "$status" -eq 2 ] ||
    fail "guard returned $status instead of 2 for: $command"
  grep -Fq "brigade guard:" "$stderr_file" ||
    fail "guard gave no clear block message for: $command"
}

assert_guard_allows() {
  command="$1"
  if run_guard "$command"; then
    return 0
  else
    status=$?
  fi
  fail "guard blocked allowed command ($status): $command"
}

assert_guard_payload_blocks() {
  label="$1"
  payload="$2"
  if run_guard_payload "$payload"; then
    fail "guard allowed invalid payload: $label"
  else
    status=$?
  fi
  [ "$status" -eq 2 ] ||
    fail "guard returned $status instead of 2 for invalid payload: $label"
  grep -Fq "brigade guard:" "$stderr_file" ||
    fail "guard gave no clear message for invalid payload: $label"
}

assert_guard_parser_failure_blocks() {
  fake_bin="$TMP_ROOT/failing-python-bin"
  mkdir -p "$fake_bin"
  cat >"$fake_bin/python3" <<'EOF'
#!/bin/sh
exit 70
EOF
  chmod +x "$fake_bin/python3"
  stderr_file="$TMP_ROOT/guard.stderr"

  if printf '%s' '{"tool_input":{"command":"git add src/a.ts"}}' |
    PATH="$fake_bin" CLAUDE_PROJECT_DIR="$TMP_ROOT/guard-repo" \
      /bin/bash "$ROOT/hooks/guard.sh" >/dev/null 2>"$stderr_file"; then
    fail "guard allowed command when parser runtime failed"
  else
    status=$?
  fi
  [ "$status" -eq 2 ] ||
    fail "guard returned $status instead of 2 when parser runtime failed"
  grep -Fq "brigade guard:" "$stderr_file" ||
    fail "guard gave no clear message when parser runtime failed"
}

test_guard_staging_policy() {
  mkdir -p "$TMP_ROOT/guard-repo/.brigade"

  assert_guard_blocks "git add -A"
  assert_guard_blocks "git -C . add -A"
  assert_guard_blocks "git -c core.quotePath=false add --all"
  assert_guard_blocks "git --no-pager add ."
  assert_guard_blocks "git add -u"
  assert_guard_blocks "git add ."
  assert_guard_blocks "git add -- ."
  assert_guard_blocks "git add :/"
  assert_guard_blocks "git add ':(top)'"
  assert_guard_blocks "git add '*'"
  assert_guard_blocks "git add './'"
  assert_guard_blocks "git add ':(glob,top)**'"
  assert_guard_blocks "git add ':(exclude)README.md'"
  assert_guard_blocks "git commit -a"
  assert_guard_blocks "git commit --all"
  assert_guard_blocks "git commit -am 'unsafe staging'"
  assert_guard_blocks "git commit -qam 'unsafe staging'"
  assert_guard_blocks "git commit -vam 'unsafe staging'"
  assert_guard_blocks "git commit -- :/"
  assert_guard_blocks "git commit -- ':(top)'"
  assert_guard_blocks "git commit -- '*'"
  assert_guard_blocks "git commit -- './'"
  assert_guard_blocks "git commit -- ':(glob,top)**'"
  assert_guard_blocks "git commit -- ':(exclude)README.md'"
  assert_guard_blocks "git commit --pathspec-from-file=paths.txt"
  assert_guard_blocks "git add .brigade/PLAN.md"
  assert_guard_blocks "git commit -- ./.brigade/config.md"

  assert_guard_blocks "echo ready && git add ."
  assert_guard_blocks "git status; git -C . commit --all"
  assert_guard_blocks "git add src/a.ts || git add .brigade/state"
  assert_guard_blocks "echo ready
git add ."
  assert_guard_blocks "git add src/a.ts
git add ."
  assert_guard_blocks "git add 'unterminated"

  assert_guard_blocks "command git add ."
  assert_guard_blocks "command -p git commit --all"
  assert_guard_blocks "env git add :/"
  assert_guard_blocks "env MODE=test git commit -a"
  assert_guard_blocks "env -S 'git add .'"
  assert_guard_blocks "env -S '-i git add .'"
  assert_guard_blocks "env --split-string='git add .'"
  assert_guard_blocks "exec -a custom /usr/bin/git add ."
  assert_guard_blocks "/usr/bin/git add '*'"
  assert_guard_blocks "/opt/homebrew/bin/git commit -- ."
  assert_guard_blocks "sh -c 'git add .'"
  assert_guard_blocks "bash -eu -c 'git commit --all'"
  assert_guard_blocks "bash --rcfile config/bashrc -c 'git add .'"
  assert_guard_blocks "/bin/sh -c 'command git add :/'"
  assert_guard_blocks "echo \"\$(git add .)\""
  assert_guard_blocks "result=\$(env git commit -a)"
  assert_guard_blocks "echo \"\`git add .\`\""
  assert_guard_blocks "echo prefix#\$(git add .)"
  assert_guard_blocks "echo prefix#\`git add .\`"
  assert_guard_blocks "cat <<'DATA'
benign body
DATA
git add ."
  assert_guard_blocks "cat <<DATA
\$(git add .)
DATA"
  assert_guard_blocks "cat <<DATA
'\$(git add .)'
DATA"
  assert_guard_blocks "eval 'git add .'"

  assert_guard_allows "git add src/a.ts tests/a.test.ts"
  assert_guard_allows "git add -u src/a.ts"
  assert_guard_allows "git -C . add -- src/a.ts tests/a.test.ts"
  assert_guard_allows "git --no-pager add src/a.ts"
  assert_guard_allows "git commit -- src/a.ts tests/a.test.ts"
  assert_guard_allows "git commit -m 'describe .brigade behavior'"
  assert_guard_allows "git commit -qm '.'"
  assert_guard_allows "git commit -vm '.brigade is local state'"
  assert_guard_allows "git commit -Sam"
  assert_guard_allows "/usr/bin/git add src/a.ts"
  assert_guard_allows "sh -c 'git add src/a.ts'"
  assert_guard_allows "cat <<'DATA'
git add .
DATA"
  assert_guard_allows "cat <<'DATA'
\$(git add .)
DATA"
  assert_guard_allows "bash script.sh -c 'git add .'"
  assert_guard_allows "bash --rcfile 'git add .' script.sh"
  assert_guard_allows "command -v git"
  assert_guard_allows "git add src/a.ts # git add ."
  assert_guard_allows "git add src/a.ts # \$(git add .)"
  assert_guard_allows "git add src/a.ts # \`git add .\`"
  assert_guard_allows "printf '%s\n' '<<EOF'"
  assert_guard_allows "echo ok # <<EOF"
  assert_guard_allows "printf '%s\n' 'git add .'"
  assert_guard_allows "printf '%s' 'git add .
still quoted text'"
  assert_guard_allows "echo git add ."
  assert_guard_allows "printf '%s' '/usr/bin/git add .'"
  assert_guard_allows "sh -c 'echo git add .'"
  assert_guard_allows "echo \"\$(printf git)\""
  assert_guard_allows "echo '\$(git add .)'"

  assert_guard_payload_blocks "malformed JSON" '{"tool_input":'
  assert_guard_payload_blocks "missing command" '{}'
  assert_guard_payload_blocks \
    "non-string command" '{"tool_input":{"command":["git","add","."]}}'
  assert_guard_parser_failure_blocks
}

config_run() { # brigade-config against a fixture repo and a fake home
  fixture="$1"
  shift
  CLAUDE_PROJECT_DIR="$fixture" BRIGADE_HOME="$fixture/home" "$ROOT/bin/brigade-config" "$@"
}

test_config_layer_precedence() {
  fixture="$TMP_ROOT/config-layers"
  mkdir -p "$fixture/home" "$fixture/.brigade"

  # Each layer sets a different key, and all three set `tier` — most specific must win.
  cat >"$fixture/home/config.json" <<'EOF'
{ "tier": "one-star", "maxParallel": 8, "policy": { "planCheck": "never" } }
EOF
  cat >"$fixture/brigade.config.json" <<'EOF'
{ "tier": "two-star", "gate": ["make test"] }
EOF
  cat >"$fixture/.brigade/config.local.json" <<'EOF'
{ "tier": "three-star" }
EOF

  json="$(config_run "$fixture" resolve --json)"
  python3 - "$json" <<'PY' || fail "brigade-config layer precedence is wrong"
import json, sys

doc = json.loads(sys.argv[1])
config, prov = doc["config"], doc["provenance"]
checks = [
    ("tier", "three-star", "local"),          # most specific layer wins
    ("maxParallel", 8, "global"),             # untouched by later layers
    ("policy.planCheck", "never", "global"),  # nested merge, not whole-object replacement
    ("gate", ["make test"], "team"),
]
for key, value, layer in checks:
    actual = config
    for part in key.split("."):
        actual = actual[part]
    if actual != value:
        raise SystemExit(f"{key}: expected {value!r}, got {actual!r}")
    if prov.get(key) != layer:
        raise SystemExit(f"{key}: expected layer {layer!r}, got {prov.get(key)!r}")
if config["mainBranch"] != "main":
    raise SystemExit("defaults layer was lost")
PY

  value="$(config_run "$fixture" get tier)"
  [ "$value" = "three-star" ] ||
    fail "brigade-config get returned '$value', expected three-star"
}

test_config_context_sources_merge_by_id() {
  fixture="$TMP_ROOT/config-sources"
  mkdir -p "$fixture/home" "$fixture/.brigade"

  cat >"$fixture/brigade.config.json" <<'EOF'
{ "contextSources": [
    { "id": "conventions", "type": "static-file", "enabled": true, "path": "README.md" },
    { "id": "kept", "type": "command", "enabled": true }
] }
EOF
  # Same id, partial entry: must tune the existing source, not append a second one.
  cat >"$fixture/.brigade/config.local.json" <<'EOF'
{ "contextSources": [ { "id": "conventions", "enabled": false } ] }
EOF
  : >"$fixture/README.md"

  json="$(config_run "$fixture" resolve --json)"
  python3 - "$json" <<'PY' || fail "brigade-config did not merge contextSources by id"
import json, sys

sources = json.loads(sys.argv[1])["config"]["contextSources"]
by_id = {s["id"]: s for s in sources}
if len(sources) != 2:
    raise SystemExit(f"expected 2 sources, got {len(sources)}: {sources!r}")
if by_id["conventions"]["enabled"] is not False:
    raise SystemExit("local layer failed to disable the team source")
if by_id["conventions"]["type"] != "static-file":
    raise SystemExit("partial override dropped fields set by the earlier layer")
if by_id["kept"]["enabled"] is not True:
    raise SystemExit("unrelated source was lost")
PY
}

test_config_prompt_overrides_stack() {
  fixture="$TMP_ROOT/config-prompts"
  mkdir -p "$fixture/home/overrides/agents" \
           "$fixture/.brigade-overrides/agents" \
           "$fixture/.brigade/overrides/prompts"

  printf 'GLOBAL RULE\n' >"$fixture/home/overrides/agents/cook.md"
  printf 'TEAM RULE\n' >"$fixture/.brigade-overrides/agents/cook.md"
  printf 'LOCAL RULE\n' >"$fixture/.brigade/overrides/prompts/cook.md"
  cat >"$fixture/.brigade/config.local.json" <<'EOF'
{ "prompts": { "cook": { "append": ["INLINE RULE"] } } }
EOF

  text="$(config_run "$fixture" prompt cook)"
  for rule in "GLOBAL RULE" "TEAM RULE" "LOCAL RULE" "INLINE RULE"; do
    printf '%s\n' "$text" | grep -Fq "$rule" ||
      fail "brigade-config prompt dropped '$rule' from the stack"
  done

  # Overrides stack rather than replace, so order is the contract.
  printf '%s\n' "$text" | python3 -c '
import sys

text = sys.stdin.read()
order = [text.index(r) for r in ("GLOBAL RULE", "TEAM RULE", "LOCAL RULE", "INLINE RULE")]
if order != sorted(order):
    raise SystemExit(f"override stack out of order: {order}")
' || fail "brigade-config prompt stacked overrides in the wrong order"
}

test_config_doctor_catches_problems() {
  fixture="$TMP_ROOT/config-doctor"
  mkdir -p "$fixture/home" "$fixture/.brigade"

  cat >"$fixture/brigade.config.json" <<'EOF'
{ "tier": "four-star", "maxParallel": 0, "nonsense": true,
  "kb": { "enabled": true },
  "contextSources": [ { "id": "dupe" }, { "id": "dupe" } ] }
EOF

  if config_run "$fixture" doctor >/dev/null 2>&1; then
    fail "brigade-config doctor passed an invalid config"
  fi

  json="$(config_run "$fixture" doctor --json || true)"
  python3 - "$json" <<'PY' || fail "brigade-config doctor missed a problem"
import json, sys

doc = json.loads(sys.argv[1])
if doc["ok"]:
    raise SystemExit("doctor reported ok on an invalid config")
problems = " ".join(p["problem"] for p in doc["problems"])
for needle in ("tier", "maxParallel", "nonsense", "kb.cli", "duplicate"):
    if needle not in problems:
        raise SystemExit(f"doctor did not report {needle!r}: {problems}")
PY

  # A repo with no config files at all is valid, not an error.
  clean="$TMP_ROOT/config-clean"
  mkdir -p "$clean/home"
  config_run "$clean" doctor >/dev/null ||
    fail "brigade-config doctor rejected a repo with no config layers"
}

test_validate_ledger_artifacts() {
  fixture="$TMP_ROOT/validate-ledger"
  mkdir -p "$fixture/.brigade/dishes/sample/state"

  # Create a valid ledger fixture.
  cat >"$fixture/.brigade/dishes/sample/state/good.md" <<'EOF'
---
doc: ledger
schema: 1
dish: sample
item: one
role: cook
model: claude-haiku-4-5-20251001
created: 2026-07-18T21:00:00Z
attempt: 1
updated: 2026-07-18T21:30:00Z
---

## Canon

C1. This is a canonical unit.

## World state

[RELIABLE] This is a reliable world state unit.
EOF

  # Create an invalid ledger fixture (missing required envelope keys and sections).
  cat >"$fixture/.brigade/dishes/sample/state/bad.md" <<'EOF'
---
doc: ledger
---

No structure here.
EOF

  # Test good.md — should validate successfully.
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/dishes/sample/state/good.md" 2>&1)"
  printf '%s\n' "$output" | grep -Fq "ok" &&
    printf '%s\n' "$output" | grep -Fq "(ledger)" ||
    fail "brigade-validate did not report ok for valid ledger: $output"

  # Test bad.md — should fail validation.
  if CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/dishes/sample/state/bad.md" >/dev/null 2>&1; then
    fail "brigade-validate passed an invalid ledger"
  fi
}

test_execute_ledger_wiring() {
  # Check presence of WORKING MEMORY layer comment in brigade-execute.js.
  count="$(grep -c 'WORKING MEMORY — this dispatch carries a ledger' "$ROOT/workflows/brigade-execute.js")"
  [ "$count" -eq 1 ] ||
    fail "brigade-execute.js missing or duplicated WORKING MEMORY layer comment (found $count, expected 1)"

  # Check presence of audit line in brigade-execute.js.
  count="$(grep -c 'Working-memory ledger — audit it' "$ROOT/workflows/brigade-execute.js")"
  [ "$count" -eq 1 ] ||
    fail "brigade-execute.js missing or duplicated audit line (found $count, expected 1)"

  # Check config kill-switch guard in brigade-execute.js source.
  grep -q '!POLICY.workingMemory' "$ROOT/workflows/src/brigade-execute.js" ||
    fail "brigade-execute.js source missing config kill-switch guard (!POLICY.workingMemory)"

  # Check small-first-attempt exclusion guard in brigade-execute.js source.
  grep -q '!item.heavy && attemptIndex === 0' "$ROOT/workflows/src/brigade-execute.js" ||
    fail "brigade-execute.js source missing small-first-attempt guard (!item.heavy && attemptIndex === 0)"

  # Test config default with isolated layers.
  fixture="$TMP_ROOT/config-ledger-default"
  mkdir -p "$fixture/home" "$fixture/.brigade"

  json="$(config_run "$fixture" resolve --json)"
  python3 - "$json" <<'PY' || fail "brigade-config default missing or incorrect workingMemory setting"
import json, sys

config = json.loads(sys.argv[1])["config"]
if config.get("workingMemory") is not True:
    raise SystemExit(f"expected workingMemory=true, got {config.get('workingMemory')!r}")
PY

  # Test MD_SCHEMA_BLOCKS.ledger fence rendering.
  node -e "const src=require('fs').readFileSync('$ROOT/workflows/config.js','utf8'); const s=new Function(src+'; return MD_SCHEMA_BLOCKS.ledger')(); process.exit(/^\x60\x60\x60yaml$/m.test(s) && !s.includes(String.fromCharCode(92)) ? 0 : 1)" ||
    fail "workflows/config.js MD_SCHEMA_BLOCKS.ledger fence rendering is broken"
}

test_status_inline_items
test_status_block_items
test_guard_staging_policy
test_config_layer_precedence
test_config_context_sources_merge_by_id
test_config_prompt_overrides_stack
test_config_doctor_catches_problems
test_validate_ledger_artifacts
test_execute_ledger_wiring
echo "PASS: brigade operational regressions"
