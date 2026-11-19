---
doc: brief
schema: 1
dish: postgres-on-one-host
item: app-data-layer
role: scout
model: sonnet
created: 2026-07-04T03:10:00Z
question: Where does the orders app talk to the warehouse?
confidence: high
sources:
  - "git ls-files src/data"
---

## Answer

Every query goes through one client module in `src/data`, behind a small query interface the
route handlers call. No handler builds SQL itself, so a Postgres client can sit behind the same
interface.
