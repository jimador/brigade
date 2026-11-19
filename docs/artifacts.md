---
title: Artifacts
description: The typed files Brigade's agents write and read, who produces each one, where it lives, and how brigade-validate checks them.
---

Every file a Brigade agent hands to another is a typed artifact: YAML frontmatter that machines read, then markdown sections in a fixed order that people read. This page shows the shared envelope, which type lives where, and a trimmed example of each. The full registry, with every rule, is [`skills/brigade/SCHEMAS.md`](../skills/brigade/SCHEMAS.md).

## Why typed artifacts

State lives in frontmatter, so the next session, the Planner and the scripts can trust it without spending model tokens re-reading prose. The Planner rejects a malformed subagent artifact the same way the inspector rejects bad code: it asks once more with the schema pasted, then treats the attempt as failed.

## The common envelope

Every artifact starts with frontmatter between two `---` lines, as the very first lines of the file:

```yaml
---
doc: report            # the type
schema: 1              # bumped only when a type changes incompatibly
dish: <dish-slug>
item: <item-slug>      # left out for dish-level docs such as plan and analyst
role: cook             # who wrote it: planner, scout, cook, cook-heavy, inspector, analyst
model: <model id that wrote this file>
created: 2026-07-04T03:10:00Z
---
```

`doc` and `schema` are required. A missing `role`, `model` or `created` is a warning.

Rules for every type:

- Never wrap the frontmatter in a code fence. A fenced envelope fails validation with "no frontmatter".
- Keys are `snake_case`, dates are ISO 8601 UTC, one document per file.
- Paths are repo-relative, and locations pin lines as `src/foo.ts:12-40`.
- `sources:` lists where the facts come from. A claim with no source is opinion, and the reader may discard it.
- Evidence is verbatim command output, never a paraphrase.
- Length budgets are ceilings. Hitting one means summarize.

A reader that meets an unknown `doc` or a higher `schema` stops and asks.

## Every type at a glance

Dish paths are under `.brigade/dishes/<dish>/`. Roadmap paths are under the roadmap folder, `.brigade/roadmaps/<slug>/` by default.

| Type | Written by | Read by | Lives at | Validated |
| --- | --- | --- | --- | --- |
| `ticket` | people, idea intake, grooming | Planner, design | the board | via `--ticket` |
| `plan` | Planner | Planner on resume, inspector, analyst | `PLAN.md` | yes |
| `packet` | Planner | cook | inside `PLAN.md` | as part of the plan |
| `brief` | scout | Planner, inspector | `briefs/<n>-<topic>.md` | yes |
| `research` | researcher | Planner, operator | `research/<item>.md` | yes |
| `report` | cook, cook-heavy | Planner, inspector | `reports/<item>-cook.md` | yes |
| `verdict` | inspector | Planner, analyst | `reports/<item>-verdict.md` | yes |
| `plan_check` | inspector | Planner | `reports/plan-check-<n>.md` | yes |
| `analyst` | analyst | Planner, you, brain-upgrade passes | `analyst.md` | yes |
| `design_swag` | design agent | you, later the Planner | `DESIGN.md` | yes |
| `design_language` | the impeccable plugin | designer, cooks, inspectors | the project's root `DESIGN.md` | no |
| `roadmap` | Planner in `/brigade:roadmap` | you, `brigade-roadmap`, later dishes | `ROADMAP.md` | yes |
| `roadmap_node` | Planner, through confirmed batches | `brigade-roadmap`, the board, you | `nodes/<id>.md` | yes |
| `roadmap_batch` | Planner, one per round | you, resume | `batches/<n>.md` | yes |
| `review_report` | review workflow | you, `/brigade:review-dispatch` | `.brigade/reviews/<slug>/report.md` | yes |
| `red_team` | Planner at handoff | the PR body, analyst | `reports/red-team-<head7>.md` | yes |
| `ledger` | cook, or the Planner | the next cook attempt, inspector, analyst | `state/<item>.md` | yes |
| `heuristic` | Planner, on your approval | future dishes | your knowledge base | no |
| `learnings` | Planner after a retro | future dishes | `.brigade/LEARNINGS.md` | no |
| `config` | onboarding, you | every dish | `.brigade/config.md` | no, see `brigade-config doctor` |

## Check artifacts with brigade-validate

`brigade-validate` checks the envelope, each type's required keys, enum values, plan DAG sanity, the plan's tables, and body length budgets. It costs no model tokens.

```bash
# every dish and roadmap under .brigade/
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate"

# one dish folder, or one file
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate" .brigade/dishes/acme-42
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate" .brigade/dishes/acme-42/reports/retry-backoff-cook.md

# a plan against its markdown ticket's test plan
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate" --ticket tickets/ACME-42.md .brigade/dishes/acme-42/PLAN.md
```

It exits 0 when everything conforms, 1 on violations and 2 on a usage error. `/brigade:validate` runs the same check in a session. Ids that point at nothing, cycles and coverage gaps in a roadmap are `brigade-roadmap check`'s job. See [Scripts](scripts.md) for both.

## ticket

The shape Brigade expects from a source ticket. On a markdown board the frontmatter carries at least `id`, `title`, `status`, `assignee`, plus optional `kind`, `worker`, `workspace`, `project` and `repo`. A ticket published from a roadmap also carries `roadmap`, `node`, `epic`, `parent_ticket`, `blocked_by` and `satisfies`.

Body sections in order: `## Goal`, `## Context`, `## Acceptance criteria`, `## Constraints`, `## Out of scope`, and optionally `## Proposed breakdown`, `## UI samples` and `## Original request`. A ticket without a Goal or Acceptance criteria fails intake: groom it first. See [Grooming](grooming.md).

```yaml
---
id: ACME-42
title: Retry failed checkout calls with backoff
status: todo
assignee: alex
kind: feature
repo: /path/to/repo
---
```

## plan

The dish DAG. Frontmatter `items` is the machine state; the body carries the detail. Status must stay current at every transition, because resume trusts it.

```yaml
---
doc: plan
schema: 1
dish: acme-42
role: planner
model: <model id>
created: 2026-07-04T03:10:00Z
ticket: ACME-42
ticket_url: null
delivery_branch: feat/checkout-retry
source: local
tier: two-star
items:
  - { slug: retry-backoff, status: todo, depends_on: [], heavy: false,
      contract: false, files: [src/checkout/retry.ts] }
---
```

Optional keys include `level` (`contracts` or `implementation`), `kind` (`build` or `research`), `writing` (a writing preset for packet checks) and `intake`. Each item can carry `attempts`, one entry per cook dispatch with model, trigger, result, cause and reason.

Body sections in order: `## Dish` (with `### Ticket test plan` when the ticket has one), `## Waves`, `## Plan-check dispositions`, `## Parked`, `## PR feedback`, `## Follow-ups`, then one `## Packet: <slug>` per item.

## packet

One item's contract, embedded in `PLAN.md` as a `## Packet: <slug>` section. It must contain these `###` sections: `Goal`, `Contracts you code against`, `Current behavior (pasted anchors)`, `Steps`, `Acceptance criteria`, `Conventions`, `Out of scope`. It adds `Preconditions & hazards` when the target code guards against a named hazard or the packet comes from a review finding. Contracts and anchors are pasted verbatim, never from memory. Budget: 120 lines. The template is [`skills/brigade/templates/work-packet.md`](../skills/brigade/templates/work-packet.md).

## brief

A scout's answer to one question.

```yaml
---
doc: brief
schema: 1
dish: acme-42
item: retry-backoff
role: scout
model: <model id>
created: 2026-07-04T03:10:00Z
question: Where does checkout call the payment client?
confidence: high
sources:
  - src/checkout/submit.ts:10-48
urls: []
---
```

Body sections in order: `## Answer`, `## Contracts`, `## Anchors`, `## Conventions`, `## Risks`, `## Not verified`. Budget: 150 lines.

## research

The deliverable of a research item: a decision-grade report on one question. `depth` sets the model and the budget: `light` (150 lines), `medium` (250) or `heavy` (400).

```yaml
---
doc: research
schema: 1
dish: acme-50
item: queue-options
role: scout
model: <model id>
created: 2026-07-04T03:10:00Z
depth: medium
confidence: medium
sources:
  - src/jobs/queue.ts:1-30
urls:
  - https://example.com/queue-docs
---
```

Body sections: `## Verdict` first, one section per acceptance criterion, an optional `## Rubric score`, then `## Open questions`.

## report

A cook's account of one attempt. `files_changed` must stay within the packet's file list.

```yaml
---
doc: report
schema: 1
dish: acme-42
item: retry-backoff
role: cook
model: <model id>
created: 2026-07-04T03:10:00Z
status: done
attempt: 1
branch: wip/checkout-retry/retry-backoff
files_changed:
  - { path: src/checkout/retry.ts, change: add exponential backoff }
commands:
  - npm test
---
```

Optional keys: `committed` (false when a policy refusal blocked the commit), `findings_addressed` on rework, and `ledger`. Body sections in order: `## Summary`, `## Evidence`, `## Decisions`, `## Out of scope`, an optional `## Confusions`, and `## Blocked` when blocked. Budget: 120 lines.

## verdict

The inspector's PASS or FAIL on one item.

```yaml
---
doc: verdict
schema: 1
dish: acme-42
item: retry-backoff
role: inspector
model: <model id>
created: 2026-07-04T03:10:00Z
verdict: FAIL
attempt_reviewed: 1
reran_gate: true
findings:
  - { id: F1, severity: high, location: "src/checkout/retry.ts:42",
      summary: retries never stop on a 4xx }
trivial_only: false
---
```

Body sections in order: `## Verdict`, `## Findings`, `## Evidence check`. Budget: 150 lines. The acceptance pass at handoff writes the same type to `reports/acceptance-verdict.md` with `item: dish`.

## plan_check

The inspector's review of a plan before dispatch. Each attempt keeps its own numbered file.

```yaml
---
doc: plan_check
schema: 1
dish: acme-42
role: inspector
model: <model id>
created: 2026-07-04T03:10:00Z
blind_sketch_first: true
findings: [M1, L1]
blocking: [M1]
---
```

Body sections in order: `## Blind sketch`, `## Comparison`, `## Recommendations`. No PASS or FAIL. Budget: 150 lines. The plan must rule on every finding id in its `## Plan-check dispositions` table.

## analyst

The retro report for a dish. See `/brigade:retro` in [Commands](commands.md).

```yaml
---
doc: analyst
schema: 1
dish: acme-42
role: analyst
model: <model id>
created: 2026-07-04T03:10:00Z
mode: standard
items_total: 4
items_reworked: 1
escalations: 0
conflicts: 0
proposals:
  - { id: P1, destination: learnings, change: <one line>,
      evidence: reports/retry-backoff-verdict.md }
---
```

`destination` is `learnings`, `heuristic`, `installed-brain` or `tooling` (intensive only). Body sections: `## Scorecard`, `## Proposal ledger` (intensive only), `## Patterns`, `## Proposals`, `## Kept`. Budget: 120 lines standard, 200 intensive.

## design_swag

The decision ledger a design swag writes and each revisit updates. See [Design and UI](design-and-ui.md).

```yaml
---
doc: design_swag
schema: 1
role: design
dish: acme-42
model: <model id>
created: 2026-07-04T03:10:00Z
ticket: ACME-42
ticket_url: null
source: local
readiness: swaggable
size_swag: M
revisits: 0
sources:
  - src/checkout/submit.ts:10-40
---
```

`readiness` is `insufficient`, `needs_product`, `needs_tech`, `swaggable` or `likely_ready`. Body sections in order: `## What this seems to be`, `## Likely shape of work`, `## Codebase grounding`, `## Decisions so far`, `## Open questions`, `## Not yet specified`, `## Out of scope`, `## Risks & unknowns`, `## Readiness`, `## Original request`. Budget: 140 lines. Questions are named, never numbered.

## design_language

The project's design system, owned by the impeccable plugin, not Brigade: the root `DESIGN.md` plus `.impeccable/design.json`. Packets and UI samples refer to tokens by name, never by raw value. Brigade keeps no copy and doesn't validate it.

## roadmap

The top file of a roadmap. See [Roadmaps](roadmap.md).

```yaml
---
doc: roadmap
schema: 1
dish: warehouse-migration
role: planner
model: <model id>
created: 2026-07-04T03:10:00Z
mode: dfs
focus: E-1
max_depth: 4
next_ids: [E-2, F-1, S-1, T-1]
---
```

`mode` is `bfs` or `dfs`; `focus` is the node to drill under, required for `dfs` and `""` otherwise. `next_ids` holds the next free id for each level letter, and ids are never reused.

Body sections in order: `## Intent`, `## Original request`, `## Systems`, `## Inventory`, `## Requirements`, `## Decisions`, `## Open questions`, `## Out of scope`, `## Batches`. Validation checks the keys, the section order and the enum columns in the Systems and Requirements tables.

## roadmap_node

One epic, feature, story or task.

```yaml
---
doc: roadmap_node
schema: 1
dish: warehouse-migration
role: planner
model: <model id>
created: 2026-07-04T03:10:00Z
id: T-3
level: task
parent: S-2
title: Copy nightly sales tables to the new warehouse
drill: leaf
satisfies: [R-4]
covers: [I-12]
depends_on: [T-2]
repo: /path/to/repo
---
```

Only `id`, `level`, `title` and `drill` are required, plus `parent` below an epic and `repo` on a leaf. The id letter (`E-`, `F-`, `S-`, `T-`) must match the level. `drill` is `open`, `split`, `leaf` or `parked`. Left-out keys mean empty: `[]` for lists, `""` for `ticket` and `status`, `unknown` for `size_swag`.

A leaf's body is the ticket contract (`## Goal`, `## Context`, `## Acceptance criteria`, `## Constraints`, `## Out of scope`). Any other node has `## Goal` and `## Children`. Budget: 60 lines.

## roadmap_batch

One confirmed round of changes. Resume replays an `approved` batch that isn't `applied` yet from its receipts.

```yaml
---
doc: roadmap_batch
schema: 1
dish: warehouse-migration
role: planner
model: <model id>
created: 2026-07-04T03:10:00Z
state: approved
operations:
  - { op: create_node, target: T-3 }
  - { op: publish, target: T-3 }
receipts:
  - { target: T-3, ticket: ACME-41, read_back: ok }
---
```

`state` is `proposed`, `approved` or `applied`. `op` is `create_node`, `update_node`, `publish`, `link` or `status`. Write `[]` for an empty list. Body sections in order: `## Proposal`, `## Dispositions`.

## review_report

A standalone advisory review. Each finding is shaped like a packet, so `/brigade:review-dispatch` can cook it. See [Reviews](reviews.md).

```yaml
---
doc: review_report
schema: 1
role: inspector
model: <model id>
created: 2026-07-04T03:10:00Z
input: { kind: branch, ref: feature/checkout-retry }
range: main..feature/checkout-retry
context_tier: documented
tier: two-star
counts: { blocking: 0, high: 1, medium: 0, low: 0 }
findings:
  - { id: F1, dimension: correctness, severity: high,
      location: "src/checkout/retry.ts:42", summary: <one line>,
      files: [src/checkout/retry.ts], fix: <direction>,
      verify_hint: <how to confirm>, confirmed: true }
---
```

`context_tier` is `bare`, `documented` or `tracked`. Body sections in order: `## Scope`, `## Findings`, `## Context disclosure`, `## Evidence`. Budget: 250 lines.

## red_team

The record of the handoff red team for one reviewed head. A new head gets a new file.

```yaml
---
doc: red_team
schema: 1
dish: acme-42
role: planner
model: <model id>
created: 2026-07-04T03:10:00Z
head: 0123abcdef
range: main...0123abcdef
find: { tool: codex, command: "codex review --base main < /dev/null" }
verify: { tool: claude, command: "claude -p \"Verify pass. ...\"" }
findings: { confirmed: 1, refuted: 2 }
verdict: clean
---
```

`range` must end at `head`. `verdict` is `clean`, `open`, `override` (needs a human `Override:` line in the body) or `stopped`. Body sections in order: `## Find pass`, `## Verify pass`, `## Findings`. Budget: 150 lines.

## ledger

A cook's working memory for heavy items and rework attempts, or the Planner's own (`item: planner`).

```yaml
---
doc: ledger
schema: 1
dish: acme-42
item: retry-backoff
role: cook
model: <model id>
created: 2026-07-04T03:10:00Z
attempt: 2
updated: 2026-07-04T04:02:00Z
---
```

Body sections in order: `## Canon` (up to 20 numbered units from the packet, never edited), `## World state` (up to 30 live units, each `[RELIABLE]` or `[PROVISIONAL]`, struck through rather than deleted), and an optional `## Archive`. Budget: 80 lines.

## heuristic, learnings and config

These aren't checked by `brigade-validate`:

- `heuristic`: one rule per note in your knowledge base, in the form `<rule>. Evidence: <what happened>. (dish: <slug>, <date>)`.
- `learnings`: `.brigade/LEARNINGS.md`, append-only, one `##` entry per retro headed with the date and the dish slug, listing its counts and the accepted learnings.
- `config`: `.brigade/config.md`, shaped by [`skills/brigade/templates/config.md`](../skills/brigade/templates/config.md). Check it with `brigade-config doctor`. See [Configuration](configuration.md).
