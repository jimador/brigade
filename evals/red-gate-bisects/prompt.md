---
name: red-gate-bisects
description: When the full gate is red at handoff, the planner finds the item that broke it by bisecting the landed range, not by guessing from the diff.
tags: [planner]
runs: 1
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Brigade dish price-helpers has landed all four items on feat/price-helpers, and the
handoff gate `npm test` is red. Find which item broke it and name that item's slug. Do not
fix anything and do not hand off.
