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
echo "  helpers:  $PLUGIN_ROOT/scripts/ — whenever brigade docs say run brigade-status/-config/-validate/-coord, use this directory (they are not on PATH)"
echo
"$SELF_DIR/../scripts/brigade-status" || true

# Which config layers are in play, plus anything wrong with them. Both are cheap and
# save the session from reading config files to find out.
if command -v node >/dev/null 2>&1 && [ -x "$SELF_DIR/../scripts/brigade-config" ]; then
  echo
  CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../scripts/brigade-config" layers || true
  if ! CONFIG_PROBLEMS="$(CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../scripts/brigade-config" doctor 2>&1)"; then
    echo
    echo "## config problems (fix before dispatching)"
    printf '%s\n' "$CONFIG_PROBLEMS" | sed 's/^/  /'
  fi
  OVERRIDES="$(CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../scripts/brigade-config" prompts 2>/dev/null || true)"
  case "$OVERRIDES" in
    *"(none)"*) ;;
    "") ;;
    *) echo; printf '%s\n' "$OVERRIDES" ;;
  esac
fi

# Onboarding drift: auto-apply pending mechanical steps; point at /brigade:onboard for the rest.
if command -v node >/dev/null 2>&1 && [ -x "$SELF_DIR/../scripts/brigade-onboard" ]; then
  ONBOARD_STATUS="$(CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../scripts/brigade-onboard" status --json 2>/dev/null || true)"
  ONBOARD_DRIFT=0
  ONBOARD_BOARD_PENDING=0
  if [ -n "$ONBOARD_STATUS" ]; then
    ONBOARD_PARSED="$(node -e '
      let s = "";
      process.stdin.on("data", (d) => { s += d; });
      process.stdin.on("end", () => {
        try {
          const doc = JSON.parse(s);
          const steps = Array.isArray(doc.steps) ? doc.steps : [];
          const boardPending = steps.some((st) => st.id === "board-config" && st.state === "pending");
          console.log((doc.drift ? "1" : "0") + " " + (boardPending ? "1" : "0"));
        } catch {
          console.log("0 0");
        }
      });
    ' <<<"$ONBOARD_STATUS" 2>/dev/null || true)"
    ONBOARD_DRIFT="$(printf '%s' "$ONBOARD_PARSED" | cut -d' ' -f1)"
    ONBOARD_BOARD_PENDING="$(printf '%s' "$ONBOARD_PARSED" | cut -d' ' -f2)"
  fi

  if [ "$ONBOARD_DRIFT" = "1" ]; then
    ONBOARD_APPLY_OUT="$(CLAUDE_PROJECT_DIR="$ROOT" "$SELF_DIR/../scripts/brigade-onboard" apply 2>&1 || true)"
    if printf '%s' "$ONBOARD_APPLY_OUT" | grep -q '^applied '; then
      echo
      echo "## onboarding upgrade applied"
      printf '%s\n' "$ONBOARD_APPLY_OUT" | sed 's/^/  /'
    fi
  fi

  if [ "$ONBOARD_BOARD_PENDING" = "1" ]; then
    echo
    echo "Setup incomplete — run /brigade:onboard to finish board wiring."
  fi
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

if [ -x "$SELF_DIR/../scripts/brigade-coord" ]; then
  echo "Shared Claude/Codex leases:"
  "$SELF_DIR/../scripts/brigade-coord" list 2>/dev/null || true
fi
echo "Design swag (/brigade:design) never claims tickets — leave status in design."
echo "</brigade-state>"
