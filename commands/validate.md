---
description: Mechanically validate brigade dish artifacts against SCHEMAS.md (zero model tokens)
allowed-tools: Bash(brigade-validate:*)
---

## Context

- !`brigade-validate`

## Task

Report the validator's verdict in ≤ 3 lines. On FAIL: list each offending artifact path
with its finding, and which producer (planner/scout/cook/inspector/analyst) must re-emit
it. Never edit artifacts to silence findings.
