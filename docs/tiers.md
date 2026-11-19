---
title: Tiers
description: Pick how much model each dish buys, from one star for mechanical work to three stars for work where a mistake is expensive.
---

A tier decides how much model you buy per dish: which model plans, which cooks first, how
often plans get checked and how deep reviews go. This page helps you pick one and override a
single row when the bundle does not fit.

## The three tiers

| | three-star | two-star (default) | one-star |
| --- | --- | --- | --- |
| say | "brigade heavy" | "brigade" | "brigade light" |
| planning (normal) | frontier: `fable`, else `opus` at max effort | `opus` | `sonnet` |
| planning (difficult) | frontier | frontier: `fable`, else `opus` at max effort | `opus` |
| scouts | sonnet, up to 6 per dish | sonnet, up to 4 | sonnet, up to 2, questions merged |
| first-attempt cook | heavy cook (sonnet) | cook (haiku) | cook (haiku) |
| escalation ladder | heavy retry, then planner | cook, cookRetry, heavy, then planner | cook, cookRetry, heavy, then planner |
| plan check | always | on triggers | never (self-check list only) |
| analyst retro | every dish (intensive), plus every 10 items | every dish | every third dish |
| `/brigade:review` depth | 8 dimensions, two verify votes on blocking and high | 4 groups, one verify vote on blocking | 1 merged pass, no verify |

Two rules hold at every tier: the session only plans, and subagents do all token-heavy work.
The tier changes how much you spend, never who does what.

## Pick one

- **Two-star by default.** It is the everyday service and the right answer most of the time.
- **Three-star when a mistake is expensive:** a shared contract, a security or
  data-correctness criterion, a migration, anything where rework costs more than the extra
  spend.
- **One-star when the work is mechanical:** docs, config, mechanical refactors, or a repo
  with a fast and trustworthy test suite.

Field data backs the default. Across 455 dishes in seven repos, first-attempt PASS was 67%
at three-star and 66% at two-star, with similar rework and escalation rates. Keep two-star as
the repo default and choose three-star per dish. `brigade-config doctor` prints a note,
never a failure, when a repo's resolved tier is three-star.

## Set the tier

From weakest to strongest:

1. the built-in default, `two-star`
2. `tier:` in the `## Repo` section of `.brigade/config.md`
3. `tier` in a JSON config layer: global, then team, then local
4. a trigger phrase for one dish: "brigade heavy" or "brigade light"

`brigade-config get tier` shows the winner and the layer that set it. `/brigade:tier` shows
or sets the repo default. The active tier is recorded in the `tier:` field of each dish's
`PLAN.md`.

## When planning escalates

Some dishes deserve a stronger planner than their tier's normal row. Below three-star, the
planning checkpoint escalates to the tier's difficult-planning model, then drops back, when
any of these fires:

- 8 or more expected items
- a shared contract whose consumers span more than 3 files
- security, concurrency or data-correctness acceptance criteria
- the repo's previous dish had 30% or more rework, or a merge conflict
- a plan check returned blocking findings

## Two floors on the ladder

The escalation ladder is the rework path after an inspector FAIL. Two rules override it at
every tier:

- Config-resolution and ORM or schema packets start on sonnet even when they look simple.
- When a FAIL is about framework semantics rather than a slip, the ladder skips the
  same-model retry and escalates immediately.

The mechanical risk table in
[`skills/brigade/policies/risk-escalation.md`](../skills/brigade/policies/risk-escalation.md),
checked by `scripts/brigade-risk`, applies at every tier and only ever adds escalation.

## Override one row

Tiers are bundles, not straitjackets. Decouple any single row through the config layers:

```json
{
  "tier": "one-star",
  "policy": { "planCheck": "always", "scoutCap": 4 },
  "models": { "inspector": "your-strong-reviewer-agent", "cookRetry": "your-mid-tier-cook-agent" }
}
```

Cheap cooks, but the plan always gets checked, the reviewer is your best model, and a retry
moves up a model. `null` or an absent key takes the tier's value. See
[Configuration](configuration.md).

## Override the planning model

The tier's planning row is a default, not a lock. Set `plannerModel` in any JSON config layer
to the model this repo's Planner session should run on, as a model alias or full id (`fable`,
`opus`, `sonnet`, `haiku`, `claude-...`), never an agent type. At dish intake the Planner
compares the live session model against `plannerModel` when it is set, and against the
tier's planning row otherwise. When they differ, it asks you to switch with `/model` or says
it is running degraded.

## Tune over time

`brigade-status` aggregates analyst retros: rework percentage, escalations and conflicts. The
analyst may propose a tier move with evidence, for example "three clean dishes at two-star,
this repo can default to one-star". Tier changes are always yours to make, in one line of
config.

The full reference is [`skills/brigade/TIERS.md`](../skills/brigade/TIERS.md). Its
machine-readable mirror, the policy the workflow scripts run against, is
[`workflows/config.js`](../workflows/config.js).
