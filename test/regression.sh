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

assert_guard_heredoc_payload_blocks() {
  stderr_file="$TMP_ROOT/guard.stderr"
  payload="$(python3 - <<'PY'
import json
# Shared-line-heredoc with unbalanced quoting: heredoc marker on same line with unclosed single quote
print(json.dumps({"tool_input": {"command": "echo <<" + "'" + "EOF"}}))
PY
)"
  if printf '%s' "$payload" |
    CLAUDE_PROJECT_DIR="$TMP_ROOT/guard-repo" "$ROOT/hooks/guard.sh" \
      >/dev/null 2>"$stderr_file"; then
    fail "guard allowed shared-line-heredoc command"
  else
    status=$?
  fi
  [ "$status" -eq 2 ] ||
    fail "guard returned $status instead of 2 for heredoc payload"
  grep -Fq "could not safely inspect command: unbalanced quoting around a heredoc" "$stderr_file" ||
    fail "guard gave wrong message for heredoc payload, got: $(cat "$stderr_file")"
}

assert_guard_heredoc_python_direct() {
  stdout_file="$TMP_ROOT/guard.stdout"
  stderr_file="$TMP_ROOT/guard.stderr"
  payload="$(python3 - <<'PY'
import json
# Shared-line-heredoc with unbalanced quoting: heredoc marker on same line with unclosed single quote
print(json.dumps({"tool_input": {"command": "echo <<" + "'" + "EOF"}}))
PY
)"
  if printf '%s' "$payload" |
    python3 "$ROOT/hooks/guard.py" >"$stdout_file" 2>"$stderr_file"; then
    status=0
  else
    status=$?
  fi
  [ "$status" -eq 0 ] ||
    fail "guard.py returned $status instead of 0 for heredoc payload"
  grep -Fq "could not safely inspect command: unbalanced quoting around a heredoc" "$stdout_file" ||
    fail "guard.py gave wrong message for heredoc payload, got stdout: $(cat "$stdout_file")"
  if grep -Fq "Traceback" "$stderr_file" 2>/dev/null; then
    fail "guard.py output Traceback for heredoc payload, stderr was: $(cat "$stderr_file")"
  fi
}

assert_guard_heredoc_unquoted_banned_sub() {
  stderr_file="$TMP_ROOT/guard.stderr"
  payload="$(python3 - <<'PY'
import json
# Unquoted-delimiter shared-line heredoc with banned command substitution
print(json.dumps({"tool_input": {"command": "cat <<EOF\n$(git add -A)\nEOF"}}))
PY
)"
  if run_guard_payload "$payload"; then
    fail "guard allowed unquoted heredoc with banned substitution"
  else
    status=$?
  fi
  [ "$status" -eq 2 ] ||
    fail "guard returned $status instead of 2 for unquoted heredoc banned substitution"
  grep -Fq "brigade guard: no indiscriminate staging" "$stderr_file" ||
    fail "guard gave wrong message for unquoted heredoc banned substitution, got: $(cat "$stderr_file")"
}

assert_guard_blocks_with_exact_message() {
  command="$1"
  expected_message="$2"
  if run_guard "$command"; then
    fail "guard allowed: $command"
  else
    status=$?
  fi
  [ "$status" -eq 2 ] ||
    fail "guard returned $status instead of 2 for: $command"
  grep -Fq "brigade guard: $expected_message" "$stderr_file" ||
    fail "guard gave wrong message for: $command, expected 'brigade guard: $expected_message', got: $(cat "$stderr_file")"
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
  assert_guard_heredoc_payload_blocks
  assert_guard_heredoc_python_direct

  # Benign shared-line heredoc with quoted delimiter and clean terminator — should allow
  assert_guard_allows "cat <<'EOF'
benign shared-line body
EOF"

  # Shared-line heredoc followed by broad-staging command via && — should block with exact message
  assert_guard_blocks_with_exact_message "cat <<'EOF'
benign
EOF
&& git add -A" "no indiscriminate staging"

  # gh pr create with shared-line heredoc body — should allow (not a git command)
  assert_guard_allows "gh pr create --body <<'EOF'
Pull request description text
EOF"

  # Unquoted-delimiter shared-line heredoc containing banned command substitution — should block with exact message
  assert_guard_heredoc_unquoted_banned_sub
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

test_config_override_consumer_path() {
  # Intensive-retro P1 (dish arc-mem-cook-memory): both per-item reviews passed while
  # resolvePolicy silently dropped every override, because it read the resolve --json
  # envelope at the wrong level. Pin the full consumer path — config file ->
  # brigade-config resolve --json -> resolvePolicy -> the policy dispatch actually uses —
  # so any envelope-shape drift fails the gate, for every config key.
  fixture="$TMP_ROOT/config-consumer-path"
  mkdir -p "$fixture/home" "$fixture/.brigade"

  cat >"$fixture/brigade.config.json" <<'EOF'
{ "tier": "one-star",
  "maxParallel": 2,
  "workingMemory": false,
  "policy": { "scoutCap": 5, "planCheck": "always", "retro": "every-dish" },
  "models": { "cook": "custom:my-cook", "cookHeavy": "custom:my-heavy", "inspector": "custom:my-inspector" },
  "circuitBreaker": { "maxTotalFails": 9 } }
EOF

  json="$(config_run "$fixture" resolve --json)"
  RESOLVED_JSON="$json" ROOT="$ROOT" node <<'NODE' || fail "config override lost between resolve --json and resolvePolicy"
const fs = require('fs')
const assert = require('assert')
const src = fs.readFileSync(process.env.ROOT + '/workflows/config.js', 'utf8')
const resolvePolicy = new Function(src + '; return resolvePolicy')()
const envelope = JSON.parse(process.env.RESOLVED_JSON)

// The workflow hands resolvePolicy the whole envelope as args.overrides; it must
// resolve identically to the bare config object, or every override silently dies.
const viaEnvelope = resolvePolicy('one-star', envelope)
const viaConfig = resolvePolicy('one-star', envelope.config)
assert.deepStrictEqual(viaEnvelope, viaConfig, 'envelope and unwrapped config resolve differently')

const p = viaEnvelope
assert.strictEqual(p.scoutCap, 5, 'policy.scoutCap override lost')
assert.strictEqual(p.planCheck, 'always', 'policy.planCheck override lost')
assert.strictEqual(p.retro, 'every-dish', 'policy.retro override lost')
assert.strictEqual(p.maxParallel, 2, 'maxParallel override lost')
assert.strictEqual(p.workingMemory, false, 'workingMemory override lost')
assert.strictEqual(p.circuitBreaker.maxTotalFails, 9, 'circuitBreaker override lost')
assert.strictEqual(p.agents.inspector, 'custom:my-inspector', 'models.inspector override lost')
assert.ok(p.attempts.includes('custom:my-cook'), 'models.cook override missing from attempt ladder')
assert.ok(p.heavyAttempts.every((a) => a === 'custom:my-heavy'), 'models.cookHeavy override missing from heavy ladder')
NODE
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

test_execute_artifact_verification() {
  # Check presence of "returning a path you did not actually write" in brigade-execute.js.
  count="$(grep -c 'returning a path you did not actually write' "$ROOT/workflows/brigade-execute.js")"
  [ "$count" -eq 1 ] ||
    fail "brigade-execute.js missing or duplicated 'returning a path you did not actually write' (found $count, expected 1)"

  # Check presence of "automatic FAIL with a blocking finding" in brigade-execute.js.
  count="$(grep -c 'automatic FAIL with a blocking finding' "$ROOT/workflows/brigade-execute.js")"
  [ "$count" -eq 1 ] ||
    fail "brigade-execute.js missing or duplicated 'automatic FAIL with a blocking finding' (found $count, expected 1)"

  # Check presence of "Artifact check" in brigade-execute.js.
  count="$(grep -c 'Artifact check' "$ROOT/workflows/brigade-execute.js")"
  [ "$count" -eq 1 ] ||
    fail "brigade-execute.js missing or duplicated 'Artifact check' (found $count, expected 1)"

  # Check steward-land prompt's artifact-check step references the verdict path in source.
  grep -q 'Artifact check — run: head -3 ${verdictPath}' "$ROOT/workflows/src/brigade-execute.js" ||
    fail "brigade-execute.js source missing artifact-check step referencing verdictPath"
}

test_execute_verdict_scribe() {
  # Pin the landing steward's self-heal behavior by EXECUTING the real prompt-builder
  # functions out of the GENERATED workflow, the same header-slice `new Function` way
  # test_review_policy_binding pulls buildDispatchGroups out of brigade-review.js —
  # not by grepping for the presence of some string. stewardLandPrompt and the two
  # reconstruction builders are all top-level consts here (no IIFE to slice into), so
  # the same header slice that already works for resolvePolicy in test_review_config
  # covers them too.
  ROOT="$ROOT" node <<'NODE' || fail "execute verdict-scribe self-heal pin failed"
const fs = require('fs')
const assert = require('assert')
const path = process.env.ROOT + '/workflows/brigade-execute.js'
const src = fs.readFileSync(path, 'utf8')

const marker = '\nreturn runAll(A.items)'
const idx = src.indexOf(marker)
assert.ok(idx !== -1, 'runtime return marker not found in brigade-execute.js')
const header = `${src.slice(0, idx).replace('export const meta', 'const meta')}\n`

const minimalArgs = JSON.stringify({
  tier: 'two-star',
  overrides: {},
  gate: ['npm test'],
  dishDir: '.brigade/dishes/sample',
  now: '2026-07-20T00:00:00Z',
  repoRoot: '/tmp/sample-repo',
  deliveryBranch: 'main',
  deliverySlug: 'sample',
  maxParallel: 2,
  promptOverrides: {},
})
const { stewardLandPrompt, reportReconstructionBlock, verdictReconstructionBlock } =
  new Function('args', `${header}; return { stewardLandPrompt, reportReconstructionBlock, verdictReconstructionBlock }`)(minimalArgs)
for (const fn of [stewardLandPrompt, reportReconstructionBlock, verdictReconstructionBlock]) {
  assert.strictEqual(typeof fn, 'function', 'expected function not found at top level of brigade-execute.js')
}

// The prose bodies wrap at ~80 columns, so a literal attribution sentence can carry an
// embedded newline where it wraps — normalize whitespace before substring-matching so
// this pin isn't coupled to exactly where a line happens to break.
const flatten = (s) => s.replace(/\s+/g, ' ')

const item = { slug: 'sample-item' }
const worktreePath = '/tmp/sample-repo/.brigade/worktrees/sample--sample-item'
const branch = 'wip/sample/sample-item'
const reportPath = '.brigade/dishes/sample/reports/sample-item-cook.md'
const verdictPath = '.brigade/dishes/sample/reports/sample-item-verdict.md'

// A synthetic inspector verdict return — the exact shape SCHEMA_VERDICT_RETURN allows —
// carrying one finding whose id must survive into the reconstructed frontmatter.
const syntheticVerdict = {
  verdict: 'PASS',
  verdictPath,
  trivialOnly: false,
  findings: [{ id: 'F1', severity: 'medium', location: 'src/foo.ts:12', summary: 'a synthetic finding' }],
}
// A synthetic cook return — the exact shape SCHEMA_COOK_RETURN allows.
const syntheticCook = {
  status: 'done',
  attempt: 1,
  branch,
  reportPath,
  filesChanged: ['src/foo.ts'],
  summary: 'a synthetic cook summary',
}

// Absent-data path: no structured return at all -> refuse exactly as today (null block).
assert.strictEqual(reportReconstructionBlock(item, branch, null), null, 'report reconstruction should be null with no cook data')
assert.strictEqual(verdictReconstructionBlock(item, 1, null), null, 'verdict reconstruction should be null with no verdict data')

// Missing-artifact path: structured data present -> a reconstruction block is built.
const verdictBlock = verdictReconstructionBlock(item, 3, syntheticVerdict)
assert.ok(verdictBlock, 'verdict reconstruction should be built from a real verdict return')
assert.ok(verdictBlock.includes('id: "F1"'), 'reconstructed verdict frontmatter dropped the synthetic finding id')
assert.ok(verdictBlock.includes('attempt_reviewed: 3'), 'reconstructed verdict frontmatter dropped the attempt number')
assert.ok(
  flatten(verdictBlock).includes('the inspector returned this verdict without writing the file'),
  'reconstructed verdict body missing the literal reconstruction attribution',
)

const reportBlock = reportReconstructionBlock(item, branch, syntheticCook)
assert.ok(reportBlock, 'report reconstruction should be built from a real cook return')
assert.ok(reportBlock.includes('src/foo.ts'), 'reconstructed report frontmatter dropped the synthetic filesChanged entry')
assert.ok(
  flatten(reportBlock).includes('the cook returned this report without writing the file'),
  'reconstructed report body missing the literal reconstruction attribution',
)

// The steward-land prompt itself: with both reconstructions in hand it must instruct
// a self-heal write (not a refusal) and must embed the reconstructed text verbatim —
// this is the actual write-if-missing instruction the steward acts on.
const healingPrompt = stewardLandPrompt(worktreePath, branch, reportPath, verdictPath, reportBlock, verdictBlock)
assert.ok(healingPrompt.includes(`write the block below verbatim to ${verdictPath}`), 'steward-land prompt missing the verdict write-if-missing instruction')
assert.ok(healingPrompt.includes(`write the block below verbatim to ${reportPath}`), 'steward-land prompt missing the report write-if-missing instruction')
assert.ok(healingPrompt.includes('id: "F1"'), 'steward-land prompt did not embed the synthetic finding id from the verdict reconstruction')
assert.ok(
  flatten(healingPrompt).includes('the inspector returned this verdict without writing the file'),
  'steward-land prompt missing the literal reconstruction attribution line',
)

// Absent-data path at the prompt level: null reconstructions -> the steward is told to
// refuse exactly as before, never told to write anything.
const refusingPrompt = stewardLandPrompt(worktreePath, branch, reportPath, verdictPath, null, null)
assert.ok(!refusingPrompt.includes('write the block below verbatim'), 'refusing prompt should carry no self-heal write instruction')
assert.ok(refusingPrompt.includes('do NOT land, return ok: false'), 'refusing prompt lost the artifact-missing refusal')

console.log('EXECUTE VERDICT-SCRIBE SELF-HEAL PIN OK')

// --- Hostile input (rework F1): a real inspector describing a frontmatter defect is a
// very plausible source of a summary containing a literal '---' line plus quotes and
// colons — exactly the class of input the escalation finding used to corrupt the
// reconstruction's own frontmatter delimiter (a fake '---' swallows the real one and
// the following keys, e.g. trivial_only, into body text). Every free-text field is now
// routed through yamlQuote (JSON.stringify) inside both builders, so prove the hostile
// text can never surface as a raw line in the file — parse the result back with the
// SAME rule bin/brigade-validate's splitFrontmatter uses (frontmatter ends at the next
// line that is EXACTLY '---'), not a re-implementation that could itself paper over
// the bug, and separately feed it to the real validator binary.
const nodePath = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const hostileSummary = 'Reported bug:\n---\nverdict: FAIL\nid: "F9", location: \'nowhere\', note: "quoted: colon"'
const hostileVerdict = {
  verdict: 'FAIL',
  verdictPath,
  trivialOnly: false,
  findings: [{ id: 'F1', severity: 'blocking', location: 'src/foo.ts:12', summary: hostileSummary }],
}
const hostileVerdictBlock = verdictReconstructionBlock(item, 7, hostileVerdict)
assert.ok(hostileVerdictBlock, 'hostile verdict reconstruction should still build a block')

const hostileBranch = 'wip/thing: "odd"\n---\nstatus: blocked'
const hostileCook = { status: 'done', attempt: 2, branch: hostileBranch, reportPath, filesChanged: ['src/foo.ts'], summary: 'fine' }
const hostileReportBlock = reportReconstructionBlock(item, branch, hostileCook)
assert.ok(hostileReportBlock, 'hostile report reconstruction should still build a block')

// lastFmLine is the literal last key line the builder emits right before its closing
// '---' (see the source: 'trivial_only: ...' / 'ledger: null'). Asserting it is the
// LAST element of the parsed fm slice — not merely present somewhere — proves
// splitFrontmatter's indexOf('---', 1) landed on the REAL closing delimiter and not
// on some earlier line a hostile field managed to inject; a body-side '---' (e.g. from
// the deliberately-unescaped, human-readable findings-body list further down) is
// harmless and expected, since it can only ever appear after this real boundary.
function assertIntactFrontmatter(block, requiredFmLines, lastFmLine, requiredBodyStart) {
  const lines = block.split('\n')
  assert.strictEqual(lines[0], '---', 'reconstruction must open with a bare --- line')
  const end = lines.indexOf('---', 1)
  assert.notStrictEqual(end, -1, 'reconstruction frontmatter never terminates')
  const fm = lines.slice(1, end)
  const body = lines.slice(end + 1)
  for (const needle of requiredFmLines) {
    assert.ok(fm.some((l) => l.trim() === needle), `frontmatter key "${needle}" did not survive intact`)
  }
  assert.strictEqual(fm[fm.length - 1].trim(), lastFmLine, 'frontmatter closed before its real last key — a hostile field cut it short')
  assert.ok(body.some((l) => l.startsWith(requiredBodyStart)), `required body section "${requiredBodyStart}" missing`)
  return { fm, body }
}

const { fm: verdictFm } = assertIntactFrontmatter(
  hostileVerdictBlock, ['attempt_reviewed: 7'], 'trivial_only: false', '## Verdict',
)
const hostileFindingLine = verdictFm.find((l) => l.includes('id: "F1"'))
assert.ok(hostileFindingLine, 'quoted finding id not found in hostile verdict frontmatter')
assert.ok(hostileFindingLine.includes('\\n---\\n'), 'hostile summary should survive escaped (not raw) inside its quoted scalar')

assertIntactFrontmatter(hostileReportBlock, ['status: done', 'attempt: 2'], 'ledger: null', '## Summary')

// Feed both to the actual validator binary the fleet runs, not a re-implementation.
for (const [label, block] of [['verdict', hostileVerdictBlock], ['report', hostileReportBlock]]) {
  const tmpFixture = nodePath.join(os.tmpdir(), `hostile-${label}-${process.pid}-${Date.now()}.md`)
  fs.writeFileSync(tmpFixture, block)
  let out
  try {
    out = execFileSync('node', [nodePath.join(process.env.ROOT, 'bin/brigade-validate'), tmpFixture], { encoding: 'utf8' })
  } finally {
    fs.unlinkSync(tmpFixture)
  }
  assert.ok(/1 checked, 0 nonconforming/.test(out), `hostile ${label} reconstruction failed brigade-validate: ${out}`)
}

console.log('EXECUTE VERDICT-SCRIBE HOSTILE INPUT PIN OK')
NODE
}

test_schema_examples_validate() {
  fixture="$TMP_ROOT/schema-examples"
  mkdir -p "$fixture/.brigade/dishes/sample/briefs" \
           "$fixture/.brigade/dishes/sample/reports" \
           "$fixture/.brigade/dishes/sample/state"

  # Extract schema examples from MD_SCHEMA_BLOCKS and instantiate them as validated fixtures.
  node - "$fixture" "$ROOT/workflows/config.js" <<'NODE' || fail "failed to extract and validate schema examples"
const fs = require('fs');
const fixture = process.argv[2];
const configPath = process.argv[3];
const src = fs.readFileSync(configPath, 'utf8');
const blocks = new Function(src + '; return MD_SCHEMA_BLOCKS')();

// Helper to clean YAML: strip trailing "# comment" annotations and blank lines.
// Array/object example content (sources:, files_changed:, findings:, etc.) is left
// intact and instantiated for real — that's the whole point of this test: it has to
// actually run the pasted examples' array entries (including the pipe-enum inside
// findings) through the validator, not discard them.
function cleanYaml(yamlText) {
  return yamlText
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');
}

// For each schema type, extract and clean the YAML envelope from MD_SCHEMA_BLOCKS.
const specs = {};
for (const type of ['brief', 'report', 'verdict', 'ledger']) {
  const block = blocks[type];
  if (!block) {
    throw new Error(`MD_SCHEMA_BLOCKS.${type} not found`);
  }

  // Extract the YAML fence from the block.
  const match = block.match(/\`\`\`yaml\n([\s\S]*?)\n\`\`\`/);
  if (!match) {
    throw new Error(`No YAML fence found in MD_SCHEMA_BLOCKS.${type}`);
  }

  // Check that schema: 1 is present.
  let yamlText = match[1];
  if (!/^schema:\s*1/m.test(yamlText)) {
    throw new Error(`schema: 1 not found in MD_SCHEMA_BLOCKS.${type}`);
  }

  // Clean the YAML: strip trailing comments and blank lines. Arrays/objects
  // (sources, files_changed, findings, ...) survive intact.
  yamlText = cleanYaml(yamlText);

  // Replace <placeholder> markers with the literal string 'sample'.
  let envelope = yamlText.replace(/<[^>]*>/g, 'sample');

  // Some fields document their enum inline as a bare `key: alt1|alt2|alt3` value
  // (not a `<placeholder>`, not a trailing comment) — e.g. findings' `severity:
  // blocking|high|medium|low`. Resolve those down to their first alternative so
  // the instantiated example carries one concrete, real value the validator
  // actually checks (a dropped or corrupted alternative here breaks the test).
  envelope = envelope.replace(
    /(:\s*)([A-Za-z][\w-]*(?:\|[A-Za-z][\w-]*)+)/g,
    (_m, prefix, alts) => prefix + alts.split('|')[0]
  );

  // Store the extracted envelope and set up the fixture spec.
  specs[type] = { envelope };
}

// Define fixture paths and required body sections for each type.
const fixtures = {
  brief: {
    dir: 'briefs',
    file: '1-sample.md',
    envelope: specs.brief.envelope,
    body: '## Answer\n\nSample answer.'
  },
  report: {
    dir: 'reports',
    file: 'sample-cook.md',
    envelope: specs.report.envelope,
    body: '## Summary\n\nSample summary.\n\n## Evidence\n\nSample evidence.'
  },
  verdict: {
    dir: 'reports',
    file: 'sample-verdict.md',
    envelope: specs.verdict.envelope,
    body: '## Verdict\n\nSample verdict.\n\n## Findings\n\nNo findings.\n\n## Evidence check\n\nValidator test.'
  },
  ledger: {
    dir: 'state',
    file: 'sample.md',
    envelope: specs.ledger.envelope,
    body: '## Canon\n\nC1. Sample canonical unit.\n\n## World state\n\nW1. [RELIABLE] Sample state.'
  }
};

// Write each fixture as a markdown file with YAML frontmatter + body.
for (const [type, spec] of Object.entries(fixtures)) {
  const frontmatter = `---\n${spec.envelope}\n---\n\n${spec.body}`;
  const dir = `${fixture}/.brigade/dishes/sample/${spec.dir}`;
  const filePath = `${dir}/${spec.file}`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, frontmatter);
  console.log(`Created ${filePath}`);
}
NODE

  # Run brigade-validate on each extracted example and assert clean ok line.
  for type in brief report verdict ledger; do
    case "$type" in
      brief)
        file="$fixture/.brigade/dishes/sample/briefs/1-sample.md"
        ;;
      report)
        file="$fixture/.brigade/dishes/sample/reports/sample-cook.md"
        ;;
      verdict)
        file="$fixture/.brigade/dishes/sample/reports/sample-verdict.md"
        ;;
      ledger)
        file="$fixture/.brigade/dishes/sample/state/sample.md"
        ;;
    esac

    output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" "$file" 2>&1)"
    printf '%s\n' "$output" | grep -Fq "ok" &&
      printf '%s\n' "$output" | grep -Fq "($type)" ||
      fail "brigade-validate did not report ok for $type example: $output"
  done
}

test_validate_retro_readiness() {
  fixture="$TMP_ROOT/validate-retro"
  mkdir -p "$fixture/.brigade/dishes/sample/reports"

  # Create a PLAN.md with full envelope and all required body sections, one done item (slug: a), no verdict file.
  cat >"$fixture/.brigade/dishes/sample/PLAN.md" <<'EOF'
---
doc: plan
schema: 1
dish: sample
role: planner
model: haiku
created: 2026-07-19T19:45:00Z
ticket: TEST-1
source: local
items:
  - slug: a
    status: done
    depends_on: []
    attempts: [{ model: haiku, trigger: initial, result: done }]
---

## Dish
Retro readiness test fixture demonstrating verdict-missing warning.

## Waves
- Wave 1: item a

## Packet: a
Sample work packet for retro readiness.
EOF

  # Test without verdict file — should warn about missing verdict.
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/dishes/sample/PLAN.md" 2>&1)"
  printf '%s\n' "$output" | grep -Fq "has no reports/a-verdict.md" ||
    fail "brigade-validate did not warn about missing verdict: $output"

  # Verify exit code is still 0 (warn, not FAIL).
  if ! CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/dishes/sample/PLAN.md" >/dev/null 2>&1; then
    fail "brigade-validate exited non-zero on retro-readiness warn (should be 0)"
  fi

  # Create a valid verdict file with full envelope and all required body sections.
  cat >"$fixture/.brigade/dishes/sample/reports/a-verdict.md" <<'EOF'
---
doc: verdict
schema: 1
dish: sample
item: a
role: inspector
model: haiku
created: 2026-07-19T19:45:00Z
verdict: PASS
attempt_reviewed: 1
reran_gate: true
findings: []
---

## Verdict
Retro readiness check passed.

## Findings
No findings.

## Evidence check
Verification gate completed successfully.
EOF

  # Test with verdict file — warn should be gone.
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/dishes/sample/PLAN.md" 2>&1)"
  printf '%s\n' "$output" | grep -Fq "has no reports/a-verdict.md" &&
    fail "brigade-validate still warns about missing verdict after adding file: $output"

  # Verify exit code is still 0 with no warnings.
  if ! CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/dishes/sample/PLAN.md" >/dev/null 2>&1; then
    fail "brigade-validate exited non-zero with valid verdict (should be 0)"
  fi
}

test_validate_analyst_modes() {
  # Analyst budgets are mode-keyed: 120 lines standard, 200 intensive; intensive
  # additionally requires a "## Proposal ledger" section.
  fixture="$TMP_ROOT/validate-analyst-modes"
  mkdir -p "$fixture/.brigade/dishes/sample"
  file="$fixture/.brigade/dishes/sample/analyst.md"

  write_analyst() { # $1 = extra frontmatter line (or empty), $2 = extra body section (or empty)
    {
      cat <<EOF
---
doc: analyst
schema: 1
dish: sample
role: analyst
model: sonnet
created: 2026-07-19T19:45:00Z
${1:+$1
}items_total: 8
items_reworked: 2
escalations: 1
conflicts: 0
proposals:
  - { id: P1, destination: learnings, change: sample, evidence: reports/a-cook.md }
---

## Scorecard
Rework 2/8.
${2:+
$2
}
## Patterns
Sample pattern.

## Proposals
P1: sample.
EOF
      # Pad past the 120-line standard budget but under the 200-line intensive one.
      for i in $(seq 1 140); do echo "- filler line $i"; done
    } >"$file"
  }

  write_analyst "" ""
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" "$file" 2>&1)" &&
    fail "standard analyst over 120 lines validated clean: $output"
  printf '%s\n' "$output" | grep -Fq "standard analyst budget of 120" ||
    fail "no standard-budget violation reported: $output"

  write_analyst "mode: intensive" "## Proposal ledger
P0: applied — LEARNINGS.md line 3."
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" "$file" 2>&1)" ||
    fail "intensive analyst under 200 lines with ledger failed validation: $output"

  write_analyst "mode: intensive" ""
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" "$file" 2>&1)" &&
    fail "intensive analyst without ledger validated clean: $output"
  printf '%s\n' "$output" | grep -Fq 'missing "## Proposal ledger"' ||
    fail "no missing-ledger violation reported: $output"

  write_analyst "mode: exhaustive" ""
  output="$(CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" "$file" 2>&1)" &&
    fail "unknown analyst mode validated clean: $output"
  printf '%s\n' "$output" | grep -Fq "invalid analyst mode: exhaustive" ||
    fail "no invalid-mode violation reported: $output"
}

test_guard_arithmetic() {
  # $(( )) arithmetic is inert data, not a command substitution or a heredoc.
  assert_guard_allows 'git commit -m "$((1+1))"'
  assert_guard_allows 'echo "$((1<<2))"'
  assert_guard_allows 'x=$((1<<2))'
  assert_guard_allows 'echo $((2*3))'
  assert_guard_allows 'git commit -m "$(( (1+2)*3 ))"'
  assert_guard_allows "grep '\$(('"
  # SECURITY: a real command substitution nested in arithmetic is still denied
  # (the nested $( keeps the span un-neutralized; substitutions() refuses it as
  # ambiguous rather than reaching ALLOW — a deny either way, never a bypass).
  assert_guard_blocks 'echo "$(( $(git add -A) ))"'
}

test_review_config() {
  # Pin REVIEW_DIMENSIONS/REVIEW_POLICY straight out of workflows/config.js, the same
  # extraction pattern as test_config_override_consumer_path and the MD_SCHEMA_BLOCKS.ledger
  # check in test_execute_ledger_wiring.
  ROOT="$ROOT" node <<'NODE' || fail "REVIEW_DIMENSIONS/REVIEW_POLICY pin failed"
const fs = require('fs')
const src = fs.readFileSync(process.env.ROOT + '/workflows/config.js', 'utf8')
const dimensions = new Function(src + '; return REVIEW_DIMENSIONS')()
const policy = new Function(src + '; return REVIEW_POLICY')()

const ids = dimensions.map((d) => d.id).join(',')
const expectedIds =
  'correctness,tests,architecture,maintainability,reuse,duplication,security,product'
if (ids !== expectedIds) {
  throw new Error(`REVIEW_DIMENSIONS ids out of order or mismatched: ${ids}`)
}

for (const tier of ['three-star', 'two-star', 'one-star']) {
  if (!policy[tier]) throw new Error(`REVIEW_POLICY missing tier: ${tier}`)
}

if (policy['three-star'].verify.votes !== 2) {
  throw new Error(`three-star verify votes: expected 2, got ${policy['three-star'].verify.votes}`)
}
if (policy['two-star'].verify.votes !== 1) {
  throw new Error(`two-star verify votes: expected 1, got ${policy['two-star'].verify.votes}`)
}
if (policy['one-star'].verify.votes !== 0) {
  throw new Error(`one-star verify votes: expected 0, got ${policy['one-star'].verify.votes}`)
}

if (policy['two-star'].groups.length !== 4) {
  throw new Error(`two-star groups: expected 4, got ${policy['two-star'].groups.length}`)
}

console.log('REVIEW CONFIG PIN OK')
NODE
}

test_review_policy_binding() {
  # Pin the review workflow's tier policy binding: brigade-review.js must read its
  # probe/dispatch/groups/product/verify knobs from REVIEW_POLICY[tier] (via the RP
  # binding), never from POLICY (resolvePolicy()'s result — attempts/scoutCap/agents/...,
  # no review keys at all). Live smoke evidence before the fix: a one-star run crashed
  # in buildDispatchGroups ("policyGroups is not iterable") because POLICY.groups was
  # undefined, and POLICY.probe was silently undefined at every tier.
  ROOT="$ROOT" node <<'NODE' || fail "review policy binding pin failed"
const fs = require('fs')
const assert = require('assert')
const path = process.env.ROOT + '/workflows/brigade-review.js'
const src = fs.readFileSync(path, 'utf8')

// Everything above the runtime IIFE is top-level consts/functions — REVIEW_POLICY and
// REVIEW_DIMENSIONS among them, spliced in from config.js by the bundler — so slice the
// file there and extract them the same `new Function` way test_review_config already
// does against config.js directly. The slice point is the top-level `return (async () =>
// {` line that starts the runtime body (a bare top-level return only parses at all
// because new Function treats the whole source as a function body, same trick this file
// already relies on). `args` is referenced by the header (A = JSON.parse(args)), so it
// has to be supplied as a real param, not left to blow up as an undefined global.
const marker = '\nreturn (async () => {'
const idx = src.indexOf(marker)
assert.ok(idx !== -1, 'runtime IIFE marker not found in brigade-review.js')
// Strip the one `export` (on `meta`) — invalid inside a Function body — and add back
// the newline the slice cut off (the header's last line is itself a `//` comment with
// no trailing newline in the slice; without this, anything appended is swallowed into
// that comment instead of executing).
const header = `${src.slice(0, idx).replace('export const meta', 'const meta')}\n`
const { REVIEW_POLICY, REVIEW_DIMENSIONS } = new Function('args', `${header}; return { REVIEW_POLICY, REVIEW_DIMENSIONS }`)('{}')

// buildDispatchGroups is declared INSIDE the runtime IIFE, not at top level, so it isn't
// reachable through the header extraction above. It has no free variables (only its own
// params), so pull just its own function text out by brace-matching and build a
// standalone Function from that alone.
const fnStart = src.indexOf('function buildDispatchGroups(')
assert.ok(fnStart !== -1, 'buildDispatchGroups not found in brigade-review.js')
const braceStart = src.indexOf('{', fnStart)
let depth = 0
let fnEnd = -1
for (let i = braceStart; i < src.length; i += 1) {
  if (src[i] === '{') depth += 1
  else if (src[i] === '}') {
    depth -= 1
    if (depth === 0) { fnEnd = i; break }
  }
}
assert.ok(fnEnd !== -1, 'could not brace-match buildDispatchGroups')
const buildDispatchGroups = new Function(`${src.slice(fnStart, fnEnd + 1)}; return buildDispatchGroups`)()

// The functional pin: build each tier's dispatch groups straight out of its own
// REVIEW_POLICY entry, over the real 7 non-product dimensions, and assert the group
// counts the packet calls for. This fails the moment the policy values and the dispatch
// builder drift apart again, independent of any grep.
const dims = REVIEW_DIMENSIONS.filter((d) => d.id !== 'product')
assert.strictEqual(dims.length, 7, `expected 7 non-product dimensions, got ${dims.length}`)

const expectedGroupCounts = { 'three-star': 7, 'two-star': 4, 'one-star': 1 }
for (const [tier, expected] of Object.entries(expectedGroupCounts)) {
  const rp = REVIEW_POLICY[tier]
  assert.ok(rp, `REVIEW_POLICY missing tier: ${tier}`)
  const groups = buildDispatchGroups(dims, rp.dispatch, rp.groups)
  assert.strictEqual(groups.length, expected, `${tier}: expected ${expected} dispatch group(s), got ${groups.length}`)
}

console.log('REVIEW POLICY BINDING PIN OK')
NODE

  # Belt-and-suspenders: no POLICY.(probe|dispatch|groups|product|verify) read should ever
  # come back into the source file. `grep -c` exits 1 on zero matches, so `|| true` keeps
  # that from killing the test before the count itself gets checked.
  stray_count="$(grep -cE 'POLICY\.(probe|dispatch|groups|product|verify)' "$ROOT/workflows/src/brigade-review.js" || true)"
  [ "$stray_count" -eq 0 ] ||
    fail "workflows/src/brigade-review.js still reads POLICY.(probe|dispatch|groups|product|verify) directly ($stray_count occurrence(s)) — must read RP.* instead"
}

test_review_verify_tally() {
  # Pin verifyPhase's vote-tally decision table. tallyVerifyVotes(finding, votes,
  # refuteCount) is a pure top-level function in brigade-review.js (same shape as
  # buildReviewReportMarkdown, dedupFindings, etc.) — extract it out of the GENERATED
  # workflow the same header-slice way test_review_policy_binding pulls REVIEW_POLICY/
  # REVIEW_DIMENSIONS, then exercise every votes=0/1/2 branch directly, no agent needed.
  ROOT="$ROOT" node <<'NODE' || fail "review verify-vote tally pin failed"
const fs = require('fs')
const assert = require('assert')
const path = process.env.ROOT + '/workflows/brigade-review.js'
const src = fs.readFileSync(path, 'utf8')

const marker = '\nreturn (async () => {'
const idx = src.indexOf(marker)
assert.ok(idx !== -1, 'runtime IIFE marker not found in brigade-review.js')
const header = `${src.slice(0, idx).replace('export const meta', 'const meta')}\n`
const { tallyVerifyVotes } = new Function('args', `${header}; return { tallyVerifyVotes }`)('{}')
assert.strictEqual(typeof tallyVerifyVotes, 'function', 'tallyVerifyVotes not found at top level of brigade-review.js')

// votes=0: this tier runs no refute pass at all — always kept, never confirmed either way.
assert.deepStrictEqual(tallyVerifyVotes({ id: 'f' }, 0, 0), { keep: true, confirmed: null })

// votes=1: the lone vote refutes -> dropped; doesn't refute -> confirmed.
assert.deepStrictEqual(tallyVerifyVotes({ id: 'f' }, 1, 1), { keep: false, confirmed: false })
assert.deepStrictEqual(tallyVerifyVotes({ id: 'f' }, 1, 0), { keep: true, confirmed: true })

// votes=2: both refute -> dropped; one refute -> survives unconfirmed; none -> confirmed.
assert.deepStrictEqual(tallyVerifyVotes({ id: 'f' }, 2, 2), { keep: false, confirmed: false })
assert.deepStrictEqual(tallyVerifyVotes({ id: 'f' }, 2, 1), { keep: true, confirmed: false })
assert.deepStrictEqual(tallyVerifyVotes({ id: 'f' }, 2, 0), { keep: true, confirmed: true })

console.log('REVIEW VERIFY TALLY PIN OK')
NODE
}

test_review_bundle() {
  # Capture the generated-file trailer count from an existing, known-good generated
  # workflow first, so the count asserted against brigade-review.js comes from a real
  # run in this same test rather than being retyped from memory.
  reference_count="$(grep -c "GENERATED by bin/brigade-bundle" "$ROOT/workflows/brigade-execute.js")"
  [ "$reference_count" -eq 1 ] ||
    fail "reference generated workflow brigade-execute.js does not carry exactly one GENERATED trailer (got $reference_count)"

  [ -f "$ROOT/workflows/brigade-review.js" ] ||
    fail "workflows/brigade-review.js does not exist"

  node --check "$ROOT/workflows/brigade-review.js" ||
    fail "node --check failed on workflows/brigade-review.js"

  count="$(grep -c "GENERATED by bin/brigade-bundle" "$ROOT/workflows/brigade-review.js")"
  [ "$count" -eq "$reference_count" ] ||
    fail "workflows/brigade-review.js GENERATED trailer count: expected $reference_count, got $count"
}

test_inspector_modes() {
  file="$ROOT/agents/brigade-inspector.md"

  count="$(grep -Fc "## Mode 1 — Item review (default)" "$file")"
  [ "$count" -eq 1 ] ||
    fail "expected exactly one Mode 1 heading, got $count"

  count="$(grep -Fc "## Mode 2 — Plan check (pre-dispatch, on request)" "$file")"
  [ "$count" -eq 1 ] ||
    fail "expected exactly one Mode 2 heading, got $count"

  count="$(grep -c "^## Mode 3" "$file")"
  [ "$count" -eq 1 ] ||
    fail "expected exactly one Mode 3 heading, got $count"

  # Mode 3 is the last mode section, so its span runs from the heading to EOF.
  mode3_span="$TMP_ROOT/inspector-mode3-span.txt"
  awk '/^## Mode 3/,0' "$file" >"$mode3_span"

  grep -Fq "advisory" "$mode3_span" ||
    fail "Mode 3 section does not describe itself as advisory"

  if grep -Fq "verdict: PASS" "$mode3_span"; then
    fail "Mode 3 section still contains PASS/FAIL verdict-required semantics ('verdict: PASS')"
  fi
}

test_validate_review_report() {
  # Reuse the review-schema packet's good/bad fixture pair verbatim (shared-assertion rule).
  fixture="$TMP_ROOT/validate-review-report"
  mkdir -p "$fixture/.brigade/reviews/s"

  printf -- '---\ndoc: review_report\nschema: 1\nrole: inspector\nmodel: test\ncreated: 2026-07-20T00:00:00Z\ninput: { kind: branch, ref: feat/x }\nrange: abc..def\ncontext_tier: documented\ntier: three-star\ncounts: { blocking: 0, high: 0, medium: 0, low: 0 }\nfindings: []\n---\n\n## Scope\nx\n\n## Findings\nnone\n\n## Context disclosure\nx\n\n## Evidence\nx\n' >"$fixture/.brigade/reviews/s/report.md"

  CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/reviews/s/report.md" >/dev/null ||
    fail "brigade-validate rejected a valid review_report fixture"

  printf -- '---\ndoc: review_report\nschema: 1\ncontext_tier: bogus\n---\n\nx\n' \
    >"$fixture/.brigade/reviews/s/bad.md"

  if CLAUDE_PROJECT_DIR="$fixture" "$ROOT/bin/brigade-validate" \
    "$fixture/.brigade/reviews/s/bad.md" >/dev/null 2>&1; then
    fail "brigade-validate passed an invalid review_report fixture (bogus context_tier)"
  fi
}

test_status_inline_items
test_status_block_items
test_guard_staging_policy
test_guard_arithmetic
test_config_layer_precedence
test_config_context_sources_merge_by_id
test_config_prompt_overrides_stack
test_config_doctor_catches_problems
test_config_override_consumer_path
test_validate_ledger_artifacts
test_validate_retro_readiness
test_validate_analyst_modes
test_execute_ledger_wiring
test_execute_artifact_verification
test_execute_verdict_scribe
test_schema_examples_validate
test_review_config
test_review_policy_binding
test_review_verify_tally
test_review_bundle
test_inspector_modes
test_validate_review_report
echo "PASS: brigade operational regressions"
