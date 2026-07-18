#!/usr/bin/env bash
# PreToolUse guard: keep .brigade/ out of git and block broad staging.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -d "$ROOT/.brigade" ] || exit 0

block() { echo "brigade guard: $1" >&2; exit 2; }

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! violation="$(python3 "$SELF_DIR/guard.py" 2>/dev/null)"; then
  block "command inspection failed; refusing command"
fi
[ -n "$violation" ] && block "$violation"
exit 0
