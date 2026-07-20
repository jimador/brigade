# Brigade service tiers (stars)

Tiers are Michelin stars. A tier sets which model plans, cooks, and reviews, and how
call-sensitive the run is. Say **brigade heavy** for ★★★, plain **brigade** for the
configured default (★★ out of the box), **brigade light** for ★.

## The tiers

| | ★★★ three-star | ★★ two-star (default) | ★ one-star |
| --- | --- | --- | --- |
| say | "brigade heavy" | "brigade" | "brigade light" |
| call sensitivity | low — spend for quality | balanced | high — every expensive call justified |
| planning (normal) | frontier (Fable / Opus-max) | opus | sonnet |
| planning (difficult) | frontier | frontier (Fable; else Opus-max) | opus |
| scouts | haiku, ≤ 6/dish; planner may read pivotal files itself | haiku, ≤ 4/dish | haiku, ≤ 2/dish, merge questions |
| first-attempt cook | brigade-cook-heavy (sonnet) | brigade-cook (haiku) | brigade-cook (haiku) |
| escalation ladder | heavy retry → planner | cook retry → heavy → planner | cook retry → heavy → planner |
| plan check | always | on triggers | never (self-check list only) |
| analyst retro | every dish (intensive) + every 10 items (standard) | every dish | every 3rd dish or on request |
| code review depth | 8 dimensions, verify blocking+high ×2 | 4 groups (+product with source), verify blocking ×1 | 1 merged pass, no verify |

The machine-readable mirror of this table (cook attempt ladders, scout caps, plan-check
policy, retro cadence) is `workflows/config.js` — the Workflow scripts are bundled
against it. Change policy there and here in the same commit.

- ★★★ — worth a special journey — the flagship service.
- ★★ — worth a detour — the everyday service.
- ★ — high quality cooking on a tight margin.

## Reading the table

**Planning rows** set the session model. The Planner IS the session: at dish intake,
compare the session model to the tier's planning row and tell the operator to `/model`
to it, or proceed degraded and say so.

**Scouts** caps research dispatches per dish. At ★ merge questions into fewer scouts; at
★★★ the planner may read pivotal files itself instead of dispatching.

**First-attempt cook** picks the initial executor: `brigade-cook-heavy` at ★★★,
`brigade-cook` elsewhere.

**Escalation ladder** is the rework path after an inspector FAIL — each arrow is the next
attempt, ending at the planner.

**Plan check** gates the adversarial pre-dispatch review: always at ★★★, on triggers at
★★, never at ★ (self-check list only).

**Code review depth** sets how `/brigade:review` splits up an ad hoc code review: at ★★★
every dimension gets its own inspector dispatch plus a 2-vote refute-framed verify pass
on every blocking/high finding; at ★★ dimensions batch into 4 groups with a single
verify vote on blocking findings, and the product dimension only runs when a
requirements source (ticket, spec, PR with explicit criteria) is found; at ★ everything
runs as one merged pass with no verify pass, and the product lens still runs — folded
into that merged pass — when a requirements source exists.

**Analyst retro** is the retro cadence. Never skip a retro silently at any tier — at ★
skipping a dish is the cadence, not an omission. At ★★★ the end-of-dish retro runs the
analyst's **intensive mode**: dispatched on opus with cross-dish inputs (all prior
analyst reports, the brigade-status efficiency aggregate, the live heuristic set), a
closure ledger over past proposals, and web-backed tooling research — it may recommend
tools, CI steps, or process changes, up to 5 proposals. The mid-dish 10-item checkpoints
stay standard so the loop stays cheap. Standard mode everywhere else.

## Difficult planning

Triggers:

- ≥ 8 expected items
- a shared contract whose consumers span > 3 files
- security, concurrency, or data-correctness acceptance criteria
- the repo's previous dish had rework ≥ 30% or a merge conflict
- a plan check returned blocking findings

When any trigger fires below ★★★, escalate the planning checkpoint to the tier's
difficult-planning model, then drop back.

## Choosing and recording a tier

Precedence, weakest to strongest:

1. built-in default (`two-star`)
2. `tier:` in `.brigade/config.md` under `## Repo`
3. `tier` in the config layers — global, then team, then repo-local
   (`brigade-config get tier` shows the winner and where it came from)
4. a trigger phrase for one dish ("brigade heavy", "brigade light")

Record the active tier in PLAN.md frontmatter `tier:`. `/brigade:tier` shows or sets the
repo default.

## Overriding individual rows

A tier is a bundle, not a straitjacket. Any single row can be decoupled from it through
the config layers — keep cheap cooks but always run the plan check, or run ★ everywhere
except a repo where the inspector should be your strongest model:

```json
{
  "tier": "one-star",
  "policy": { "planCheck": "always", "scoutCap": 4 },
  "models": { "inspector": "your-strong-reviewer-agent" }
}
```

`null` (or an absent key) means "take the tier's value". See
[docs/configuration.md](../../docs/configuration.md).

## Tier tuning (the efficiency flywheel)

brigade-status aggregates analyst retros — rework %, escalations, conflicts. The analyst
may propose a tier move with evidence ("three clean dishes at ★★ → default this repo ★").
Tier changes are the operator's call: one line in config.
