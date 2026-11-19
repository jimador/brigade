---
description: Upgrade open tickets, dishes and roadmaps, and re-render their HTML pages, to the installed brigade version's rules
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap-view:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-plan-view:*)
---

## Context

- !`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard" status --json`

## Task

Follow `skills/onboard/UPGRADES.md` (read the gap, inventory open work, plan, confirm once,
apply, verify and record) using the status above as the gap. If `drift` is also true and
`board-config` is pending, finish that with `skills/onboard/SKILL.md` first.
