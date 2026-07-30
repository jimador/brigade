---
description: Set up brigade in this repo, or repair/upgrade an existing setup
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard:*)
---

## Context

- !`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard" status --json`
- !`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard" detect --json`

## Task

Follow `skills/onboard/SKILL.md` (Scan → Plan → Interview → Execute → Verify) using the
context above as the Scan input. Never re-run `status`/`detect` unless the operator changes
something Scan already read.
