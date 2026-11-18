---
doc: roadmap
mode: bfs
---

## Inventory

| id | system | thing | evidence | covered by | excluded by |
|----|--------|-------|----------|------------|-------------|
| I-1 | SYS-1 | export job | briefs/export.md | — | — |
| I-2 | SYS-1 | export config file | briefs/export.md | — | — |
| I-3 | SYS-1 | legacy report | briefs/export.md | none | legacy-report-dropped |

## Requirements

| id | kind | statement | source | status |
|----|------|-----------|--------|--------|
| R-1 | functional | Orders load nightly | intent | accepted |
| R-2 | parity | Counts match | I-1 | Accepted |
| R-3 | risk | Alerts fire | grill | proposed |
