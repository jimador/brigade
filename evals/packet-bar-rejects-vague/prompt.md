---
name: packet-bar-rejects-vague
description: The planner's packet bar rejects a vague work packet and names what is missing.
tags: [planner]
runs: 1
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

A teammate on our brigade fleet wrote this work packet for a cook: "look around the codebase
and improve error handling where appropriate". Using the brigade work-packet bar, does it pass?
Answer in five lines.
