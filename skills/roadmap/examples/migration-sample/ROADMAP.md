---
doc: roadmap
schema: 1
dish: postgres-on-one-host
role: planner
model: opus
created: 2026-07-04T03:10:00Z
mode: bfs
focus: ""
max_depth: 4
next_ids: [E-4, F-6, S-1, T-6]
---

## Intent

The orders app keeps serving every endpoint it serves today, but its data lives in Postgres on
one bare-metal host we run ourselves instead of in the cloud warehouse. The warehouse and its
nightly export bucket are switched off once the app has run on Postgres for two weeks.

## Original request

We pay too much for the warehouse for what the orders app does with it. Move the app's data to
Postgres on the bare-metal box, in a VM, and keep the app working exactly as it does now. The
nightly exports in object storage are the copy we trust, load from those.

## Systems

| id | kind | locator | command | access |
|----|------|---------|---------|--------|
| SYS-1 | repo | acme/orders-app | `git ls-files src/data` | ok |
| SYS-2 | warehouse | analytics, schema app | `list-tables --schema app` | ok |
| SYS-3 | object storage | bucket exports | `list-objects exports/orders/ \| head` | ok |
| SYS-4 | host | db-host | `virsh list --all` | ok |

## Inventory

| id | system | thing | evidence | covered by | excluded by |
|----|--------|-------|----------|------------|-------------|
| I-1 | SYS-1 | warehouse query client in src/data | briefs/1-app-data-layer.md | T-1 | — |
| I-2 | SYS-2 | app.orders table | briefs/2-warehouse-tables.md | T-3 | — |
| I-3 | SYS-2 | app.customers table | briefs/2-warehouse-tables.md | T-3 | — |
| I-4 | SYS-3 | nightly orders and customers export files | briefs/3-export-files.md | T-4 | — |
| I-5 | SYS-2 | scheduled weekly revenue report | briefs/2-warehouse-tables.md | — | weekly-report-dropped |
| I-6 | SYS-4 | host disk snapshots | briefs/4-host.md | F-5 | — |

## Requirements

| id | kind | statement | source | status |
|----|------|-----------|--------|--------|
| R-1 | functional | Every current API endpoint answers the same against Postgres | intent | accepted |
| R-2 | parity | Row counts in Postgres match the warehouse for every moved table | grill | accepted |
| R-3 | inventory | Every export file in the bucket loads into Postgres | I-4 | accepted |
| R-4 | risk | A lost host is back in service from a backup within a day | grill | accepted |
| R-5 | constraint | Postgres runs in a VM on the one host | intent | accepted |
| R-6 | functional | Keep the weekly revenue report | I-5 | dropped |

## Decisions

- **load-from-exports**: the export files are the source of truth, so loads read the bucket, never
  the warehouse — briefs/3-export-files.md
- **weekly-report-dropped**: nobody has opened the weekly revenue report this year, so it is not
  moved — briefs/2-warehouse-tables.md
- **order**: bfs, so every epic is sized before any one is finished.

## Open questions

- **backup-target** — `grilling` · HITL — Do the host's nightly backups go to the object storage bucket or to a second local disk? F-5 waits on this. Blocked by: none

## Out of scope

- Moving any app other than the orders app.
- Retiring the warehouse account itself; that follows two weeks after cut-over.

## Batches

- 1 — applied — created and published the three epics
- 2 — applied — split each epic into features and drafted five ready tasks
