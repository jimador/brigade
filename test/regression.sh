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

  # Create a PLAN.md with one done item (slug: a) and no verdict file.
  cat >"$fixture/.brigade/dishes/sample/PLAN.md" <<'EOF'
---
doc: plan
schema: 1
ticket: TEST-1
source: local
items:
  - slug: a
    status: done
    depends_on: []
    attempts: [{ model: haiku, trigger: initial, result: done }]
---

## Dish
Retro readiness fixture.

## Packet: a
Sample packet.
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

  # Create a valid verdict file.
  cat >"$fixture/.brigade/dishes/sample/reports/a-verdict.md" <<'EOF'
---
doc: verdict
schema: 1
verdict: PASS
attempt_reviewed: 1
reran_gate: true
findings: []
---

## Verdict
All checks passed.

## Findings
No findings.

## Evidence check
Verification successful.
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

test_status_inline_items
test_status_block_items
test_guard_staging_policy
test_config_layer_precedence
test_config_context_sources_merge_by_id
test_config_prompt_overrides_stack
test_config_doctor_catches_problems
test_validate_ledger_artifacts
test_validate_retro_readiness
test_execute_ledger_wiring
test_execute_artifact_verification
test_schema_examples_validate
echo "PASS: brigade operational regressions"
