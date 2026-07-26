---
description: Brigade state snapshot — tier, dishes, worktrees, efficiency — at zero exploration cost
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-status:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord:*)
---

## Context

- !`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-status"`
- !`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" list`

## Task

Summarize the snapshot above in ≤ 6 lines: active service tier, each dish's items by
status, worktrees, leases, and the efficiency numbers. Flag anything stuck (blocked/rework
items, stale worktrees, coordination leases needing investigation). Do not re-read dish
artifacts — the snapshot is authoritative.
