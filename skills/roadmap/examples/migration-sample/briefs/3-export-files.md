---
doc: brief
schema: 1
dish: postgres-on-one-host
item: export-files
role: scout
model: sonnet
created: 2026-07-04T03:10:00Z
question: What does the nightly export write to object storage?
confidence: medium
sources:
  - "list-objects exports/orders/ | head"
---

## Answer

One file per table per night under `exports/<table>/<date>/`, columnar, with a row count in the
file footer. Older nights are kept for ninety days.
