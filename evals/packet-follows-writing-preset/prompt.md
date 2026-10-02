---
name: packet-follows-writing-preset
description: With the ste-80 writing preset on, the planner writes a packet whose steps are short, single, imperative instructions.
tags: [planner]
runs: 1
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Plan ticket trim-display-name with brigade as a one-item dish. Write the packet to
`.brigade/dishes/sample/packet.md`, do not dispatch anything, do not claim the ticket. Stop
once the packet is written. Keep the Steps section of the packet free of code fences.
