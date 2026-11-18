---
doc: roadmap
mode: bfs
focus: E-1
max_depth: 3
next_ids: [E-3, F-5, S-2, T-4]
---

## Intent

Move the nightly order export from the old Node app into the warehouse loader.

## Original request

Retire the nightly export job and load orders straight into the warehouse.

## Systems

| id | kind | locator | read-only command | access |
|----|------|---------|-------------------|--------|
| SYS-1 | repo | acme/api | `git log --oneline \| head` | ok |
| SYS-2 | warehouse | orders schema | `select count(*) from orders` | missing |

## Inventory

| id | system | thing | evidence | covered by | excluded by |
|----|--------|-------|----------|------------|-------------|
| I-1 | SYS-1 | nightly export job | briefs/export.md | F-1 | — |
| I-2 | SYS-2 | orders table | briefs/orders.md | T-3 | — |
| I-3 | SYS-1 | legacy CSV report | briefs/export.md | — | legacy-report-dropped |
| I-4 | SYS-2 | export audit log | briefs/orders.md | F-4 | — |

## Requirements

| id | kind | statement | source | status |
|----|------|-----------|--------|--------|
| R-1 | functional | Orders land in the warehouse every night | intent | accepted |
| R-2 | parity | Row counts match the old export | I-2 | accepted |
| R-3 | risk | A failed load alerts the on-call | grill | proposed |
| R-4 | constraint | Keep the CSV report | grill | dropped |

## Decisions

- **legacy-report-dropped**: nobody reads the CSV report, so it goes away — briefs/export.md

## Open questions

- **retention-window** — `grilling` · HITL — How long does F-2 keep raw export files in object storage? Blocked by: none

## Out of scope

Reporting dashboards.

## Batches

- 1: applied — created E-1, E-2 and their features
