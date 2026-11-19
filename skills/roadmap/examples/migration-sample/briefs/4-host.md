---
doc: brief
schema: 1
dish: postgres-on-one-host
item: host
role: scout
model: sonnet
created: 2026-07-04T03:10:00Z
question: What already runs on the bare-metal host?
confidence: high
sources:
  - "virsh list --all"
---

## Answer

No VMs yet. The host takes a disk snapshot every night and keeps seven; nothing copies them off
the host.
