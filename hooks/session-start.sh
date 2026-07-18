#!/usr/bin/env bash
# SessionStart hook: when the repo has a .brigade/ setup, inject a compact
# state snapshot, optional live heuristics from the configured KB CLI, and the
# tier-aware cost rules — so the session resumes mechanically.
# Silent in non-brigade repos.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -d "$ROOT/.brigade" ] || exit 0

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SELF_DIR/.." && pwd)"
HOME_BRIGADE="${HOME}/.brigade"
CFG_GLOBAL="${HOME_BRIGADE}/config.json"
CFG_LOCAL="${ROOT}/.brigade/config.local.json"

echo "<brigade-state>"
echo "This repo has an active brigade setup. Current mechanical state:"
echo
echo "CLAUDE_PLUGIN_ROOT (for Workflow scriptPath): $PLUGIN_ROOT"
echo "  research: $PLUGIN_ROOT/workflows/brigade-research.js"
echo "  execute:  $PLUGIN_ROOT/workflows/brigade-execute.js"
echo
"$SELF_DIR/../bin/brigade-status" || true

# Which config layers are in play, plus anything wrong with them. Both are cheap and
# save the session from reading config files to find out.
if command -v node >/dev/null 2>&1 && [ -x "$SELF_DIR/../bin/brigade-config" ]; then
  echo
  CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../bin/brigade-config" layers || true
  if ! CONFIG_PROBLEMS="$(CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../bin/brigade-config" doctor 2>&1)"; then
    echo
    echo "## config problems (fix before dispatching)"
    printf '%s\n' "$CONFIG_PROBLEMS" | sed 's/^/  /'
  fi
  OVERRIDES="$(CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../bin/brigade-config" prompts 2>/dev/null || true)"
  case "$OVERRIDES" in
    *"(none)"*) ;;
    "") ;;
    *) echo; printf '%s\n' "$OVERRIDES" ;;
  esac
fi

# Optional KB heuristics from ~/.brigade/config.json (or repo overlay).
if command -v jq >/dev/null 2>&1; then
  CFG=""
  if [ -f "$CFG_LOCAL" ]; then CFG="$CFG_LOCAL"
  elif [ -f "$CFG_GLOBAL" ]; then CFG="$CFG_GLOBAL"
  fi
  if [ -n "$CFG" ]; then
    ENABLED="$(jq -r '.kb.enabled // false' "$CFG" 2>/dev/null || echo false)"
    CLI="$(jq -r '.kb.cli // empty' "$CFG" 2>/dev/null || true)"
      if [ "$ENABLED" = "true" ] && [ -n "$CLI" ] && command -v "$CLI" >/dev/null 2>&1; then
        # Portable argv build (Bash 3 + Bash 4)
        ARGS=()
        while IFS= read -r arg; do
          [ -n "$arg" ] && ARGS+=("$arg")
        done < <(jq -r '.kb.search_args[]?' "$CFG" 2>/dev/null || true)
        if [ "${#ARGS[@]}" -gt 0 ]; then
          HEUR="$("$CLI" "${ARGS[@]}" 2>/dev/null | jq -r '.[] | "  - \(.title)  [\(.path)]"' 2>/dev/null || true)"
          if [ -n "$HEUR" ]; then
            echo
            echo "## live brigade heuristics (operator KB via $CLI)"
            echo "$HEUR"
            echo "  Apply while decomposing/dispatching; soft-fail if a note cannot be read."
          fi
        fi
      fi
  fi
fi

TIER="$(grep -E '^- tier:' "$ROOT/.brigade/config.md" 2>/dev/null | head -1 | sed -E 's/^- tier: *([a-z-]+).*/\1/')" || true
[ -n "$TIER" ] || TIER="two-star (default)"

echo
echo "Service tier: $TIER — model choice, scout caps, plan-check policy, and retro cadence come from the tier (skills/brigade/TIERS.md)."
echo "Say \"brigade heavy\" (three-star) or \"brigade light\" (one-star) to override for one dish."
echo "Whatever the tier: the planner never explores or implements; subagents do all token-heavy work; brigade-status is free — prefer it over re-reading artifacts."
echo "Design swag (/brigade:design) never claims tickets — leave status in design."
echo "</brigade-state>"
