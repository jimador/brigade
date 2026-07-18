---
description: Show the resolved brigade configuration — every layer, the winning value per key, and any prompt overrides
allowed-tools: Bash(brigade-config:*)
---

## Context

- !`brigade-config layers`
- !`brigade-config resolve`
- !`brigade-config prompts`
- !`brigade-config doctor`

## Task

Summarize in ≤ 8 lines: which layer files exist, the settings that differ from the
built-in defaults (say which layer set each), any prompt overrides in play, and any
validation problems. If `doctor` reported problems, name the file and the fix.

Do not read the config files yourself — the output above is authoritative.
