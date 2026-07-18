---
description: Brigade state snapshot — tier, dishes, worktrees, efficiency — at zero exploration cost
allowed-tools: Bash(brigade-status:*)
---

## Context

- !`brigade-status`

## Task

Summarize the snapshot above in ≤ 6 lines: active service tier, each dish's items by
status, worktrees, and the efficiency numbers. Flag anything stuck (blocked/rework items,
stale worktrees). Do not re-read dish artifacts — the snapshot is authoritative.
