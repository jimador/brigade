# Service tiers

A tier decides how much model you buy per dish. Michelin stars, because the trade is the
same one a kitchen makes: how much craft goes into each plate.

| | ★★★ three-star | ★★ two-star (default) | ★ one-star |
| --- | --- | --- | --- |
| say | "brigade heavy" | "brigade" | "brigade light" |
| planning (normal) | frontier | opus | sonnet |
| planning (difficult) | frontier | frontier | opus |
| scouts | haiku, ≤ 6 per dish | haiku, ≤ 4 | haiku, ≤ 2, questions merged |
| first-attempt cook | heavy cook (sonnet) | cook (haiku) | cook (haiku) |
| escalation ladder | heavy retry → planner | cook retry → heavy → planner | cook retry → heavy → planner |
| plan check | always | on triggers | never |
| analyst retro | every dish + every 10 items | every dish | every 3rd dish |

Two rules hold at every tier: the session **only plans**, and subagents do **all**
token-heavy work. The tier changes how much you spend, never who does what.

## Picking one

- **★★ by default.** It is the everyday service and the right answer most of the time.
- **★★★ when a mistake is expensive** — a shared contract, a security or data-correctness
  criterion, a migration, anything where rework costs more than the extra spend.
- **★ when the work is mechanical** — docs, config, mechanical refactors, a repo with a
  fast and trustworthy test suite.

Say `brigade heavy` or `brigade light` to pick a tier for one dish. Set the repo default
with `tier` in config, or `/brigade:tier`.

## Difficult planning

Some dishes deserve a stronger planner than their tier's normal row. When any of these
fires below ★★★, the planning checkpoint escalates and then drops back:

- 8 or more expected items
- a shared contract whose consumers span more than 3 files
- security, concurrency, or data-correctness acceptance criteria
- the repo's previous dish had 30%+ rework or a merge conflict
- a plan check returned blocking findings

## Overriding one row

Tiers are bundles, not straitjackets. Decouple any single row through the config layers:

```json
{
  "tier": "one-star",
  "policy": { "planCheck": "always" },
  "models": { "inspector": "your-strong-reviewer-agent" }
}
```

Cheap cooks, but the plan always gets checked and the reviewer is your best model. See
[configuration.md](configuration.md).

## Tuning over time

`brigade-status` aggregates analyst retros — rework percentage, escalations, conflicts.
The analyst may propose a tier move with evidence ("three clean dishes at ★★, this repo
can default to ★"). Tier changes are always yours to make: one line in config.

Full reference, including the machine-readable policy the workflow scripts run against:
[`skills/brigade/TIERS.md`](../skills/brigade/TIERS.md).
