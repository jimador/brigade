#!/usr/bin/env bash
# Brigade is a Claude Code PLUGIN. Preferred install (no copying, updates are live):
#
#   claude plugin marketplace add <this directory>     # or /plugin marketplace add <dir>
#   claude plugin install brigade@brigade              # or /plugin install brigade@brigade
#
# One-off testing without installing:  claude --plugin-dir <this directory>
#
# This script is the LEGACY copy install (pre-plugin layout) and remains for
# environments where plugins are unavailable. Usage: ./install.sh [--legacy|--uninstall]
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SKILLS_DEST="$CLAUDE_DIR/skills"
AGENTS_DEST="$CLAUDE_DIR/agents"
AGENTS=(brigade-scout brigade-cook brigade-cook-heavy brigade-inspector brigade-analyst brigade-design)
SKILLS=(brigade groom)

if [[ "${1:-}" == "--uninstall" ]]; then
  for s in "${SKILLS[@]}"; do rm -rf "$SKILLS_DEST/$s"; done
  for a in "${AGENTS[@]}"; do rm -f "$AGENTS_DEST/$a.md"; done
  echo "brigade legacy copies removed from $CLAUDE_DIR"
  echo "If installed as a plugin, also run: claude plugin uninstall brigade@brigade"
  exit 0
fi

if [[ "${1:-}" != "--legacy" ]]; then
  echo "Brigade is a Claude Code plugin. Preferred install:"
  echo
  echo "  claude plugin marketplace add $SRC_DIR"
  echo "  claude plugin install brigade@brigade"
  echo
  echo "Or test without installing:  claude --plugin-dir $SRC_DIR"
  echo
  echo "To force the old copy-into-~/.claude install instead: ./install.sh --legacy"
  exit 0
fi

mkdir -p "$SKILLS_DEST" "$AGENTS_DEST"

for s in "${SKILLS[@]}"; do
  rm -rf "$SKILLS_DEST/$s"
  cp -R "$SRC_DIR/skills/$s" "$SKILLS_DEST/$s"
done
{
  echo "source: $SRC_DIR"
  echo "installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$SKILLS_DEST/brigade/PROVENANCE"

for a in "${AGENTS[@]}"; do
  cp "$SRC_DIR/agents/$a.md" "$AGENTS_DEST/$a.md"
done

echo "Installed (legacy copy):"
for s in "${SKILLS[@]}"; do echo "  skill  → $SKILLS_DEST/$s"; done
for a in "${AGENTS[@]}"; do echo "  agent  → $AGENTS_DEST/$a.md"; done
echo
echo "Note: the SessionStart/PreToolUse hooks, slash commands, the Workflow"
echo "orchestration scripts (workflows/), and the brigade-status/brigade-config/"
echo "brigade-validate PATH commands are plugin-only features and are NOT active"
echo "in a legacy copy install."
echo
echo "Next: in Claude Code say e.g. 'groom my board with brigade' or 'work my tickets'."
echo "First run in a repo walks you through .brigade/config.md setup (Notion, ClickUp,"
echo "or a local tasks/ folder of markdown files)."
