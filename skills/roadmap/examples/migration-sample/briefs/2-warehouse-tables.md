---
doc: brief
schema: 1
dish: postgres-on-one-host
item: warehouse-tables
role: scout
model: sonnet
created: 2026-07-04T03:10:00Z
question: Which tables and scheduled jobs live in the app schema?
confidence: high
sources:
  - "list-tables --schema app"
---

## Answer

Two tables, `orders` and `customers`, and one scheduled job that builds a weekly revenue
report. The report's last read was more than a year ago.
