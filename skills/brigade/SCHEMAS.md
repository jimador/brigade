# Brigade artifact schemas (v1)

Every document a brigade agent produces or consumes has a **type**, and every type has a
fixed shape: YAML frontmatter (machine-readable envelope) + markdown body sections in a
fixed order (human-readable content). This file is the registry — the single authority on
those shapes. Agents MUST emit conforming documents; the Planner rejects malformed
subagent output the same way the Inspector rejects bad code; the Inspector checks
conformance of the artifacts it reviews.

## The common envelope

Every brigade artifact starts with frontmatter carrying at least:

```yaml
---
doc: report            # the type, from the registry below
schema: 1              # bump only when a type changes incompatibly
dish: <dish-slug>
item: <item-slug>      # omit for dish-level docs (plan, analyst)
role: cook             # producer: planner|scout|cook|cook-heavy|inspector|analyst
model: haiku           # the model that actually produced it
created: 2026-07-04T03:10:00Z
---
```

Conventions for all types:

- Keys are `snake_case`; dates are ISO 8601 UTC; one document per file.
- Paths are **repo-relative** (`src/foo/bar.ts`); locations pin lines with
  `path:start-end` (`src/foo/bar.ts:12-40`).
- `sources:` lists where the document's facts come from — code locations, artifact paths,
  or URLs. **A claim without a source in `sources` (or inline `file:line`) is opinion, and
  the consumer may discard it.** What counts as an acceptable authority is defined per
  type below.
- Evidence is verbatim command output, never paraphrase.
- Length budgets are ceilings, not targets — hitting one means summarize, not overflow.

## Type registry

### `ticket` — the source ticket's expected shape (board / vault)

Producer: humans, idea intake, or a grooming pass. Consumer: Planner (intake), Design.

On markdown boards (local/obsidian), frontmatter carries at least: `id`, `title`, `status`
(`backlog|scoping|design|todo|in_progress|in_review|done|blocked`), `assignee`, optional
`kind`, `worker`, `workspace`, `project`, `repo`. Brigade's body contract remains these
sections in order (a well-groomed ticket makes Phase 0–2 dramatically cheaper):

- `## Goal` — the outcome in one short paragraph, user-visible behavior first.
- `## Context` — codebase grounding: the files/modules involved (repo-relative paths,
  `path:start-end` where known), relevant prior tickets/PRs, and any URLs. Claims about
  the code cite locations — unverified beliefs are marked as such.
- `## Acceptance criteria` — checkboxes; each one observable/verifiable, not vibes
  ("returns 403 for expired tokens", not "auth works properly").
- `## Constraints` — what must not change, deadlines, dependencies, security/data notes.
- `## Out of scope` — the tempting adjacent work this ticket explicitly excludes.
- `## Proposed breakdown` — *optional*: a human's suggested split into sub-tasks (e.g.
  absorbed from the board's child tasks at grooming). One bullet per piece, each with the
  files/areas it's believed to touch. This is a **decomposition hint for the Planner, not
  a contract** — Phase 2 re-derives the real work items and packets from fresh scout
  research, honoring the hint where it holds and recording where it didn't.
- `## Original request` — the verbatim original text when a grooming pass restructured
  the ticket; never delete what a human wrote.

Budget: ≤ 60 lines of body. A ticket missing Goal or Acceptance criteria fails intake
readiness — groom it (see `prompts/groom-board.md`) or ask, don't guess.

### `plan` — the dish DAG (`.brigade/dishes/<dish>/PLAN.md`)

Producer: Planner. Consumers: Planner (resume), Inspector (plan check), Analyst.

```yaml
doc: plan
ticket: <source ticket id>         # verbatim, copy-pasteable
ticket_url: <url|null>
delivery_branch: feat/<slug>       # delivery-named (repo's own convention); becomes the PR — never brigade/*
source: notion                     # which adapter
tier: two-star                     # service tier the dish is cooked at — three-star|two-star|one-star (TIERS.md)
kind: build                        # optional: build (default) | research — research dishes carry no packets; each item's board ticket is its contract, and items take a research depth (see the research type)
intake:                            # reconciliation decisions from the intake sweep
  - { ticket: <id>, decision: absorb|cross-reference|leave, note: <one line> }
items:                             # the DAG, one entry per work item
  - { slug: <item-slug>, status: todo|dispatched|in_review|rework|done|blocked,
      depends_on: [<slug>...], heavy: false, files: [<path>...],
      attempts: [{ model: haiku|sonnet|opus|frontier|planner, trigger: initial|fail-retry|escalation,
                   result: done|failed|blocked }] }
```

`tier` records the service tier so resume and the analyst score against the right
expectations. `rework` = runnable again after an inspector FAIL (same branch, escalation ladder).
`attempts` is the dispatch record — one entry per Cook dispatch of the item (who ran it,
why, how it ended); it is where escalation history lives, so the analyst scores from the
plan instead of re-reading report trails.

Body sections, in order: `## Dish` (goal + acceptance criteria from the ticket),
`## Waves` (planned dispatch order), then one `## Packet: <slug>` per item (see `packet`)
— build dishes only; a `kind: research` plan has no packet sections.
The `items` list in frontmatter is the machine state; body packets carry the detail. Keep
frontmatter `status` current at every transition — resume trusts it.

### `packet` — one work item's contract (embedded in PLAN.md)

Producer: Planner. Consumer: cook. Format and quality bar live in
`templates/work-packet.md`; schema-wise a packet MUST contain, as `### `-sections:
`Goal`, `Contracts you code against` (pasted code), `Current behavior (pasted anchors)`,
`Steps` (typed Explore/Implement/Verify), `Acceptance criteria` (checkboxes),
`Conventions`, `Out of scope` — plus `Preconditions & hazards` whenever the target module
defends against a named input-hazard class or the packet derives from a review/audit finding
(names the hazard/premise, forbids the wrong shortcut, requires a targeted adversarial test).
Authority: contracts and anchors are pasted verbatim from
scout briefs or named files — never from memory. Budget: ≤ 120 lines per packet.

### `brief` — scout research answer (`briefs/<n>-<topic>.md`)

Producer: scout. Consumers: Planner (packet-writing), Inspector (plan check).

```yaml
doc: brief
question: <the one question, verbatim>
confidence: high|medium|low
sources:                          # authority: the code itself, nothing else
  - src/auth/session.ts:10-48
  - package.json:12
urls: []                          # only if the question required external docs
```

Body sections, in order: `## Answer` (2–5 sentences, first), `## Contracts` (pasted
signatures with locations), `## Anchors` (pasted snippets where changes land),
`## Conventions`, `## Risks`, `## Not verified` (what confidence hinges on).
Budget: ≤ 150 lines. Everything pasted is verbatim from the working tree.

### `research` — deep-research deliverable (`research/<item>.md`, research dishes)

Producer: a researcher (model set by depth, below). Consumers: Planner (synthesis), the
operator. Where a `brief` orients the Planner, a `research` document IS the deliverable of
a research work item: a decision-grade report on one question, candidate, or survey area.

```yaml
doc: research
item: <the research ticket slug>
depth: light|medium|heavy         # set per item at plan time
confidence: high|medium|low
sources:                          # repo claims: the code itself
  - src/auth/session.ts:10-48
urls:                             # every external claim cites a full URL
  - https://...
```

`depth` sets both the researcher and the report — one axis, chosen per item when the plan
is written (independent of the dish's service tier, which still governs planning, plan
check, and retro):

| depth | model | budget | web | scope |
|---|---|---|---|---|
| light | haiku | ≤ 150 lines | only if the question demands it | one narrow question, repo-first |
| medium | sonnet | ≤ 250 lines | yes | one candidate or area, sourced and comparison-ready |
| heavy | opus | ≤ 400 lines | yes, liberally | decision-grade: multi-family surveys, rubric scoring, adversarial both-sides cases |

Body sections, in order: `## Verdict` first (≤ 5 lines; a planner-written synthesis may
open with `## Recommendation` instead), then one `## ` section per acceptance criterion of
the item's ticket, then `## Open questions`. When the dish uses a shared scoring rubric, a
`## Rubric score` table (one row per criterion, one-line justification per cell, weighted
total) goes just before `## Open questions`. Authority: repo claims cite `file:line`,
external claims cite full URLs; a claim with neither is opinion and must be labeled as
such.

### `report` — cook execution report (`reports/<item>-cook.md`)

Producer: cook / cook-heavy. Consumers: Planner (triage), Inspector (review).

```yaml
doc: report
status: done|blocked
attempt: 1                        # 2+ = rework pass
branch: wip/<delivery-slug>/<item-slug>
files_changed:                    # must be ⊆ the packet's file list
  - { path: src/foo.ts, change: <one line> }
commands:                         # every Verify command run, in order
  - bun test src/foo.test.ts
findings_addressed: []            # rework only: finding id → how resolved
ledger: <path|null>               # working-memory ledger, when the dispatch carried one
```

Body sections, in order: `## Summary` (what changed, why, ≤ 5 lines), `## Evidence`
(verbatim tail of each command's output — the verdict line must be visible),
`## Decisions` (judgment calls the packet left open), `## Out of scope` (noticed, not
touched), and for `status: blocked` a `## Blocked` section stating exactly what
contradicted the packet. Authority: the working tree and the commands' real output.
Budget: ≤ 120 lines.

### `verdict` — inspector review (`reports/<item>-verdict.md`)

Producer: inspector. Consumers: Planner (merge/rework decision), Analyst.

```yaml
doc: verdict
verdict: PASS|FAIL
attempt_reviewed: 1
reran_gate: true                  # false requires a reason in the body
findings:
  - { id: F1, severity: blocking|high|medium|low, location: "src/foo.ts:42",
      summary: <one line> }
trivial_only: false               # true = all findings annotation-only, no redispatch needed
```

Body sections, in order: `## Verdict` (one line), `## Findings` (per finding: what's
wrong, why it matters, concrete fix direction — ids matching frontmatter), `## Evidence
check` (what was re-run, verbatim result tail). Authority: the actual diff and the
inspector's own command runs; the cook's report is a claim, not a source.
Budget: ≤ 150 lines.

### `plan_check` — inspector's pre-dispatch plan review (`reports/plan-check.md`)

Producer: inspector (plan check mode). Consumer: Planner.

```yaml
doc: plan_check
blind_sketch_first: true          # sworn: sketch written before reading PLAN.md
blocking: []                      # list of must-settle-before-dispatch items
```

Body sections, in order: `## Blind sketch` (own decomposition: titles + files + edges),
`## Comparison` (coverage, disjointness, granularity, packet spot-checks),
`## Recommendations` (per-item, concrete). No PASS/FAIL. Budget: ≤ 150 lines.

### `analyst` — retro report (`.brigade/dishes/<dish>/analyst.md`)

Producer: analyst. Consumers: Planner, the user, future brain-upgrade passes.

```yaml
doc: analyst
items_total: 8
items_reworked: 2
escalations: 1
conflicts: 0
proposals:
  - { id: P1, destination: learnings|heuristic|installed-brain,
      change: <one line>, evidence: <artifact path or file:line> }
```

Body sections, in order: `## Scorecard` (one line per axis: metric, number, worst
offender), `## Patterns`, `## Proposals` (per proposal: the change, motivating evidence,
and for `heuristic` destinations the ready-to-ingest one-liner), `## Kept` (one thing that
worked). Authority: only artifacts the dish produced (plan, briefs, reports, verdicts,
git log). Budget: ≤ 120 lines.

### `design_swag` — one-shot Design pass (`.brigade/dishes/<slug>/DESIGN.md`)

Producer: Design agent (`agents/brigade-design.md`). Consumers: operator (curation), later
Planner when the ticket is promoted. **Not** a substitute for cook packets.

```yaml
doc: design_swag
schema: 1
role: design
ticket: <source ticket id>
ticket_url: <url|null>
source: obsidian                   # adapter id
readiness: swaggable               # insufficient|needs_product|needs_tech|swaggable|likely_ready
size_swag: M                       # XS|S|M|L|XL|unknown — estimate only
sources:
  - path/to/file.ts:10-40
```

Body sections, in order: `## What this seems to be`, `## Likely shape of work`,
`## Codebase grounding`, `## Open questions`, `## Risks & unknowns`, `## Readiness`,
`## Original request`. Budget: ≤ 100 lines. Must **not** claim the ticket, set `worker`,
create packets, or promote to `todo`.

### `ledger` — cook working memory (`.brigade/dishes/<dish>/state/<item>.md`)

Producer: cook (heavy items and rework attempts — dispatches whose prompt carries a
`WORKING MEMORY` block). Consumers: the next attempt's cook (inheritance), Inspector
(Canon audit), Analyst. Protocol: `MEMORY.md` next to this file.

```yaml
doc: ledger
schema: 1
dish: <dish-slug>
item: <item-slug>
role: cook
model: <model id of the last writer>
created: <ISO8601>                # first seeding
attempt: 1                        # highest attempt that wrote this ledger
updated: <ISO8601>                # stamp of the last write
```

Body sections, in order: `## Canon` (≤ 20 numbered `C<n>.` units, seeded from the packet,
never edited — a wrong Canon unit is a packet defect reported BLOCKED), `## World state`
(≤ 30 live numbered `W<n>.` units, each tagged `[RELIABLE]` or `[PROVISIONAL]`;
supersede by strikethrough + replacement, never delete), `## Archive` (optional —
struck/stale units moved on overflow). Budget: ≤ 80 lines.

### `heuristic` — durable KB note (via configured KB CLI)

Producer: Planner (on user approval). Consumers: every future dish; brain-upgrade passes.

Frontmatter is managed by the operator's KB tool when configured; brigade's contract is
the body shape — exactly one rule per note:

```
<rule, one sentence, imperative>. Evidence: <what happened>. (dish: <slug>, <date>)
```

Lifecycle: `active` while live; retire by marking absorbed in the KB or in
`skills/brigade/policies/heuristics.md`. Budget: ≤ 15 lines.

### `learnings` — repo-local memory (`.brigade/LEARNINGS.md`)

Append-only. Each entry:

```
## <date> — <dish-slug>
- items: N, reworked: N, escalated: N, conflicts: N
- <accepted learning, one line each>
```

### `config` — per-repo settings (`.brigade/config.md`)

Shape defined by `templates/config.md`. Read first on every dish; the status map and
verification gate listed there are authoritative for the whole run.

## Versioning & enforcement

- `schema: 1` today. A consumer meeting an unknown `doc` or higher `schema` stops and
  asks rather than guessing.
- The Planner spot-checks envelope + required frontmatter on every subagent artifact it
  reads; a malformed artifact is re-requested once with the schema pasted, then treated
  as a failed attempt.
- The Inspector verifies the report it reviews conforms (a report without verbatim
  evidence fails on evidence grounds regardless of the code).
