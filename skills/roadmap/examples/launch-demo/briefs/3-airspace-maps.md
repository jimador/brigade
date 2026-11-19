---
doc: brief
schema: 1
dish: skyhop-launch
item: airspace-maps
role: scout
model: sonnet
created: 2026-11-01T18:00:00Z
question: What does the airspace maps bucket hold for the two pilot cities?
confidence: high
sources:
  - "list-objects airspace-maps/ | head"
---

## Answer

One polygon file per city for no-fly zones, one for pilot delivery zones, and one landing pad
registry per city. The registry lists pad ids and coordinates but no street addresses, which is
why landing pads still need their own feature.

## Anchors

```text
$ list-objects airspace-maps/ | head
airspace-maps/city-a/no-fly.geojson
airspace-maps/city-a/pilot-zone.geojson
airspace-maps/city-a/pads.csv
airspace-maps/city-b/no-fly.geojson
airspace-maps/city-b/pilot-zone.geojson
airspace-maps/city-b/pads.csv
```
