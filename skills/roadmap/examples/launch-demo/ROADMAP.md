---
doc: roadmap
schema: 1
dish: skyhop-launch
role: planner
model: opus
created: 2026-11-02T15:00:00Z
mode: bfs
focus: ""
max_depth: 4
next_ids: [E-5, F-10, S-2, T-11]
---

## Intent

Acme Skyhop launches 30-minute drone delivery in two pilot cities. A customer inside a pilot zone
picks "Skyhop, 30 min" at checkout, a charged drone is in the air within two minutes of payment,
and the customer watches it fly to their landing pad on a live map. Every flight respects no-fly
zones and stays on the ground in bad wind. Courier delivery keeps working exactly as it does today.

## Original request

We want drone delivery live in the two pilot cities by launch day. Checkout offers it inside the
zones, dispatch gets a drone up fast, customers can watch it come in, and nothing flies where it
should not. Don't break courier orders while we do it.

## Systems

| id | kind | locator | command | access |
|----|------|---------|---------|--------|
| SYS-1 | repo | acme/storefront | `git ls-files src/checkout` | ok |
| SYS-2 | repo | acme/dispatch | `git ls-files services` | ok |
| SYS-3 | message stream | topics drone.* | `list-topics --prefix drone.` | ok |
| SYS-4 | object storage | bucket airspace-maps | `list-objects airspace-maps/ \| head` | ok |
| SYS-5 | vendor API | drone vendor flight API, sandbox | `flight-api status --env sandbox` | missing |

## Inventory

| id | system | thing | evidence | covered by | excluded by |
|----|--------|-------|----------|------------|-------------|
| I-1 | SYS-1 | shipping option picker in src/checkout | briefs/1-checkout-and-dispatch.md | T-1 | none |
| I-2 | SYS-1 | order confirmation email template | briefs/1-checkout-and-dispatch.md | T-3 | none |
| I-3 | SYS-1 | order status screen in the mobile app | briefs/1-checkout-and-dispatch.md | F-6 | none |
| I-4 | SYS-2 | paid order queue consumer | briefs/1-checkout-and-dispatch.md | T-5 | none |
| I-5 | SYS-2 | courier SMS notifier | briefs/1-checkout-and-dispatch.md | none | sms-stays-courier |
| I-6 | SYS-3 | drone.telemetry topic | briefs/2-telemetry-topics.md | T-7 | none |
| I-7 | SYS-3 | drone.battery topic | briefs/2-telemetry-topics.md | T-6 | none |
| I-8 | SYS-4 | no-fly zone polygons | briefs/3-airspace-maps.md | T-8 | none |
| I-9 | SYS-4 | landing pad registry | briefs/3-airspace-maps.md | none | none |
| I-10 | SYS-5 | vendor flight plan endpoint | none | F-4 | none |

## Requirements

| id | kind | statement | source | status |
|----|------|-----------|--------|--------|
| R-1 | functional | Customers inside a pilot zone see a 30-minute drone option at checkout | intent | accepted |
| R-2 | functional | A paid drone order has a charged drone assigned within two minutes | intent | accepted |
| R-3 | functional | Customers watch their drone on a live map that updates at least every 5 seconds | grill | accepted |
| R-4 | risk | No flight plan crosses a no-fly zone, and a geofence breach aborts the flight | grill | accepted |
| R-5 | risk | Flights hold on the ground when wind is over the vendor's limit | grill | accepted |
| R-6 | inventory | Every landing pad in the registry maps to a deliverable address | I-9 | accepted |
| R-7 | constraint | Checkout p95 latency grows by no more than 50 ms | grill | accepted |
| R-8 | parity | Courier orders check out and notify exactly as they do today | intent | accepted |
| R-9 | functional | Customers choose a delivery time window for drone orders | grill | dropped |

## Decisions

- **pilot-zones-from-maps**: pilot zones are the polygons in the airspace-maps bucket, never a
  hand-kept list - briefs/3-airspace-maps.md
- **sms-stays-courier**: the SMS notifier only serves bike couriers; drone orders notify in the
  app, so I-5 is not touched - briefs/1-checkout-and-dispatch.md
- **no-time-windows**: launch ships "as soon as possible" only; time windows (R-9) wait for
  after the pilot - grill
- **order**: bfs, so every epic is sized before any one branch runs deep.

## Open questions

- **vendor-sandbox** - `task` · HITL - F-4: Who requests sandbox keys for the vendor flight API? F-4 stays parked until a scout can read its flight plan contract. Blocked by: none
- **wind-source** - `research` · AFK - F-8: Does the vendor API report gusts per pad, or do we need our own weather feed? Blocked by: vendor-sandbox

## Out of scope

- Cities beyond the two pilot cities.
- Drone hardware, charging docks and pilot certification; the vendor owns them.
- Delivery time windows (R-9).

## Batches

- 1: applied: created the four epics, drilled them into features, one story and ten tasks, published the epics and T-1
- 2: applied: published the prerequisite leaves T-3, T-7 and T-8, then T-4, T-5, T-2 and T-6, and linked their blockers
- 3: proposed: drill F-6 (live map) and F-9 (landing pads)
