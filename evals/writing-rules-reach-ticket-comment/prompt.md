---
name: writing-rules-reach-ticket-comment
description: The repo's writing rules for the ticket comment shape the handoff comment the planner writes.
tags: [planner]
runs: 1
max_turns: 16
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

The brigade dish for ticket trim-display-name is finished: the change is committed on main
and the acceptance pass in `.brigade/dishes/trim-display-name/reports/` is green. Use brigade
to write the ticket's handoff comment to `comment.md` at the repo root. Do not post it to the
ticket, do not change the ticket, do not dispatch anything. Stop once `comment.md` is written.
