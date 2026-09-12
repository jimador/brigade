---
name: status-reads-the-snapshot
description: The status command summarizes the injected snapshot without re-reading dish artifacts.
tags: [commands]
runs: 1
max_turns: 6
allowed_tools: [Read, Glob, Grep]
---

/brigade:status
