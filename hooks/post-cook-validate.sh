#!/usr/bin/env bash
# SubagentStop hook for the artifact-writing fleet agents (cooks and the inspector).
# When one finishes, validate the dish artifacts written in the last few minutes; if any
# are nonconforming, block the stop and hand the agent the validator's findings so it
# fixes its own output while it is still cheap — before the inspector or the merge gate
# spends tokens on a malformed report.
#
# Blocks at most twice per agent (SubagentStop has no built-in loop guard), then lets the
# agent stop and surfaces the failure to the user instead. Silent and instant in repos
# with no .brigade state.
set -euo pipefail

INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -d "$ROOT/.brigade/dishes" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE="$SELF_DIR/../scripts/brigade-validate"
[ -x "$VALIDATE" ] || VALIDATE="node $SELF_DIR/../scripts/brigade-validate"

# Only artifacts written recently — this agent's output, not the whole repo's history.
# A pre-existing failure in an old dish must never block today's cooks.
RECENT=()
while IFS= read -r file; do
  [ -n "$file" ] && RECENT+=("$file")
done < <(find "$ROOT/.brigade/dishes" -type f -name '*.md' \
  \( -path '*/reports/*' -o -path '*/state/*' \) -mmin -10 2>/dev/null)
[ "${#RECENT[@]}" -gt 0 ] || exit 0

set +e
FINDINGS="$(CLAUDE_PROJECT_DIR="$ROOT" $VALIDATE "${RECENT[@]}" 2>&1)"
STATUS=$?
set -e
[ "$STATUS" -eq 0 ] && exit 0

AGENT_ID="$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("agent_id") or "unknown")
except Exception: print("unknown")')"
GUARD="${TMPDIR:-/tmp}/brigade-postcook-${AGENT_ID}"
COUNT="$(cat "$GUARD" 2>/dev/null || echo 0)"
case "$COUNT" in *[!0-9]*) COUNT=0 ;; esac

if [ "$COUNT" -ge 2 ]; then
  # Two fix attempts is enough; a third block risks a stuck agent. Let it stop and
  # tell the operator instead.
  printf '%s' "$FINDINGS" | python3 -c 'import json,sys
lines = [l for l in sys.stdin.read().splitlines() if l.startswith("FAIL")][:8]
print(json.dumps({"systemMessage": "brigade artifacts still nonconforming after 2 fix rounds — run brigade-validate:\n" + "\n".join(lines)}))'
  exit 0
fi
echo $((COUNT + 1)) >"$GUARD"

# The mtime window can catch a sibling agent's artifact in a parallel wave, so the
# reason tells the agent to fix only its own output and finish cleanly otherwise —
# a cook must never touch another item's files to satisfy this hook.
printf '%s' "$FINDINGS" | python3 -c 'import json,sys
lines = [l for l in sys.stdin.read().splitlines() if l.startswith("FAIL")][:12]
reason = ("brigade-validate: recently written dish artifacts do not conform to "
          "SCHEMAS.md:\n" + "\n".join(lines) + "\n"
          "If an artifact listed above is one YOU wrote in this run, fix it to match "
          "its schema (edit it, never delete it), then finish. Artifacts you did not "
          "write are another agent'\''s — leave them alone and finish normally.")
print(json.dumps({"decision": "block", "reason": reason}))'
exit 0
