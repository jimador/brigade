#!/usr/bin/env bash
# SubagentStop hook for the artifact-writing fleet agents (cooks, the inspector, and
# scouts). Scouts write briefs/, which brigade-validate checks as type `brief`.
#
# Two checks, both while the agent is still cheap to correct:
#   1. A MISSING artifact. If the hook input carries agent_transcript_path, the hook reads
#      the agent's dispatch prompt (the first user message) for the output path it was told
#      to write ("Write your brief to:", "Write your cook report to:", "Write your verdict
#      to:", or "Output path:"). If that .md path is under .brigade/dishes/ and does not
#      exist, the stop is blocked and the agent is told to write it now from what it
#      already has, marking anything unconfirmed as not verified. A missing, unreadable or
#      unparseable transcript, or a prompt with no declared path, changes nothing.
#   2. A MALFORMED artifact. The dish artifacts written in the last few minutes (briefs,
#      reports, research, state) are run through brigade-validate; if any are
#      nonconforming, the stop is blocked and the agent gets the validator's findings so it
#      fixes its own output before the inspector or the merge gate spends tokens on it.
#
# Not verified: whether Claude Code fires SubagentStop when a subagent stops because it hit
# its maxTurns cap. When the hook does not fire there, the planner resumes the agent with
# the same instruction.
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

AGENT_ID="$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("agent_id") or "unknown")
except Exception: print("unknown")')"
GUARD="${TMPDIR:-/tmp}/brigade-postcook-${AGENT_ID}"

# The output path the agent was told to write, read from its dispatch prompt (the first
# user message of its transcript). Prints nothing unless the path ends in .md, sits under
# a .brigade/dishes/ directory, and does not exist yet.
MISSING="$(printf '%s' "$INPUT" | python3 -c 'import json,os,re,sys
try:
    tpath = json.load(sys.stdin).get("agent_transcript_path")
    if not tpath: sys.exit(0)
    prompt = ""
    with open(tpath) as fh:
        for line in fh:
            try: rec = json.loads(line)
            except Exception: continue
            msg = rec.get("message") or {}
            if rec.get("type") != "user" and msg.get("role") != "user": continue
            content = msg.get("content", rec.get("content"))
            if isinstance(content, list):
                content = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
            prompt = content if isinstance(content, str) else ""
            break
    pat = r"(?:Write your brief to|Write your cook report to|Write your verdict to|Output path):[ \t]*`?([^\s`]+)"
    for m in re.finditer(pat, prompt):
        p = m.group(1).rstrip(".,;")
        if p.endswith(".md") and "/.brigade/dishes/" in p and not os.path.exists(p):
            print(p)
            break
except Exception:
    pass' 2>/dev/null || true)"

# Block this stop with $1 as the reason, at most twice per agent; on the third call let the
# agent stop and put $2 in front of the operator instead.
block_or_give_up() {
  COUNT="$(cat "$GUARD" 2>/dev/null || echo 0)"
  case "$COUNT" in *[!0-9]*) COUNT=0 ;; esac
  if [ "$COUNT" -ge 2 ]; then
    printf '%s' "$2" | python3 -c 'import json,sys
print(json.dumps({"systemMessage": sys.stdin.read()}))'
    exit 0
  fi
  echo $((COUNT + 1)) >"$GUARD"
  printf '%s' "$1" | python3 -c 'import json,sys
print(json.dumps({"decision": "block", "reason": sys.stdin.read()}))'
  exit 0
}

if [ -n "$MISSING" ]; then
  block_or_give_up \
    "brigade: you were told to write $MISSING and it does not exist. Write it now from what you already have, with anything you have not confirmed marked as not verified. Do not resume research or exploration; write the file, then finish." \
    "brigade: an agent stopped without writing its artifact: $MISSING"
fi

# Only artifacts written recently — this agent's output, not the whole repo's history.
# A pre-existing failure in an old dish must never block today's cooks.
RECENT=()
while IFS= read -r file; do
  [ -n "$file" ] && RECENT+=("$file")
done < <(find "$ROOT/.brigade/dishes" -type f -name '*.md' \
  \( -path '*/reports/*' -o -path '*/state/*' -o -path '*/briefs/*' \
  -o -path '*/research/*' \) -mmin -10 2>/dev/null)
[ "${#RECENT[@]}" -gt 0 ] || exit 0

set +e
FINDINGS="$(CLAUDE_PROJECT_DIR="$ROOT" $VALIDATE "${RECENT[@]}" 2>&1)"
STATUS=$?
set -e
[ "$STATUS" -eq 0 ] && exit 0

LINES="$(printf '%s' "$FINDINGS" | grep '^FAIL' | head -12 || true)"
# The mtime window can catch a sibling agent's artifact in a parallel wave, so the
# reason tells the agent to fix only its own output and finish cleanly otherwise —
# a cook must never touch another item's files to satisfy this hook.
block_or_give_up \
  "brigade-validate: recently written dish artifacts do not conform to SCHEMAS.md:
$LINES
If an artifact listed above is one YOU wrote in this run, fix it to match its schema (edit it, never delete it), then finish. Artifacts you did not write are another agent's — leave them alone and finish normally." \
  "brigade artifacts still nonconforming after 2 fix rounds — run brigade-validate:
$(printf '%s' "$LINES" | head -8)"
