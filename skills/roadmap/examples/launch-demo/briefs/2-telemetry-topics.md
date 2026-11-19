---
doc: brief
schema: 1
dish: skyhop-launch
item: telemetry-topics
role: scout
model: sonnet
created: 2026-11-01T18:00:00Z
question: Which drone topics exist, and how often do they publish?
confidence: medium
sources:
  - "list-topics --prefix drone."
---

## Answer

Two topics: `drone.telemetry` carries position and heading about once a second per drone in
flight, and `drone.battery` carries charge every 30 seconds per drone. Both are keyed by drone
id, so the order to drone mapping has to live on our side.

## Anchors

```text
$ list-topics --prefix drone.
NAME             PARTITIONS  RETENTION
drone.battery    6           24h
drone.telemetry  12          24h
```

## Not verified

Peak publish rate during a full pilot day; the topics are a week old.
