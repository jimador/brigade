---
name: groom
description: Board grooming session for the brigade fleet. Use when the user wants to groom their board, organize/clean up tickets, break down features into tickets, split or merge tickets, or get a board ready for brigade work. Triggers on "groom my board", "organize my tickets", "break down this feature", "clean up the backlog".
---

# Groom the board

A grooming session takes any task board — Notion, ClickUp, or a local folder of markdown
files — and iterates with the user until its tickets are organized by product feature and
sharp enough to cook. It is a conversation: every restructure is a proposal the user
confirms, and **nothing is dispatched to cooks from a grooming session** — that happens
later, when the user says go on a specific ticket (the main `brigade` skill).

Load the brigade skill's `SCHEMAS.md` (next to the main SKILL.md in this plugin) for the
`ticket` schema. Read `.brigade/config.md` for the source transport and status mapping; if
it doesn't exist, run brigade init first (see the main skill § Setup).

## 1. Collect

Use the source adapter's *list my tickets* operation (all open tickets assigned to the
user, any pre-done status). Show the list with one line each and let the user exclude any
before you start. Batch the reads: fetch each ticket's full title, body, and comments once
— **including any child tasks / sub-items** the board nests under it (they fold into the
parent's grooming; do not groom child tasks as separate tickets).

## 2. Organize by product feature (the PM pass — you)

Before touching any single ticket, look at the whole set:

- **Cluster** tickets into the product features / high-level work items they actually
  serve. Name each cluster in the user's product language, not repo language.
- **Flag duplicates and overlaps** (two tickets describing one behavior) as merge
  candidates, and **multi-behavior tickets** (a goal that needs "and") as split candidates.
- **Propose an ordering** by product value within and across clusters.

Present the clustering + candidates as a proposal and iterate until the user likes the
shape. Restructures are applied in step 4 only after confirmation:

- **Split**: replace one ticket with siblings that each hold one behavior; every sibling
  cross-references the original; the original is closed or becomes the feature-level
  parent.
- **Merge**: the survivor absorbs both bodies (originals preserved); the other ticket is
  closed with a cross-reference comment.
- **Reparent/regroup**: move tickets under the feature-level item they serve, where the
  source supports hierarchy (else record the grouping in the ticket bodies).

## 3. Review — two perspectives per ticket, in parallel where independent

**Scout pass (grounding).** Dispatch one `brigade-scout` per ticket with: the ticket text,
the repo root, the question "Which files, modules, and contracts does this ticket actually
touch, and do its claims about the codebase hold?", and a brief output path under
`.brigade/grooming/<ticket-key>-brief.md`. Paste the `brief` schema block into the
dispatch. The brief supplies the `## Context` section: real paths with `path:start-end`
anchors, plus corrections where the ticket's assumptions are wrong.

**Inspector pass (contract quality).** Dispatch `brigade-inspector` in plan-check spirit,
one per ticket, with the ticket text (child tasks included) + the scout's brief + the
`ticket` schema block, and this charge: adversarially assess the ticket as a *work
contract* — is the Goal one outcome or three? Is each acceptance criterion observable and
mechanically checkable? What constraint or out-of-scope boundary is missing that will bite
an executor? What would make this ticket decomposable into ≤ 3-file work items? Where the
ticket has child tasks, assess them as a proposed decomposition. Output: a short findings
list (severity + concrete fix), written to `.brigade/grooming/<ticket-key>-findings.md`.
No PASS/FAIL — grooming is advisory.

## 4. Rewrite and restructure (you, the Planner)

For each surviving ticket, synthesize original text + scout brief + inspector findings
into a body conforming to the `ticket` type in SCHEMAS.md:

- `## Goal` — one outcome, sharpened from the original.
- `## Context` — from the scout brief: real paths, anchors, corrected assumptions; mark
  the unverified.
- `## Acceptance criteria` — checkboxes, each observable; convert vague criteria using the
  inspector's fixes; add the missing ones the inspector flagged.
- `## Constraints` and `## Out of scope` — from findings + original text.
- `## Proposed breakdown` — only when the ticket had child tasks: one bullet per child,
  annotated with files/areas and warnings. No work packets here — packets are built at
  dish time from fresh research.
- `## Original request` — the verbatim original body, preserved at the bottom. Never
  destroy what a human wrote.

Where the reviews exposed a genuine open question (ambiguous scope, an undefined value,
contradictory requirements), do NOT invent an answer: list it at the top under
`**Open questions**` — phrased decision-ready (the specific value/definition needed, with
options and a recommendation where the answer space is enumerable) — and leave the ticket
out of the ready status.

## 5. Update the source

Show the user each groomed body and every split/merge/reparent (a compact before/after
summary is fine) and get **one confirmation for the batch**. Then apply via the configured
transport: replace bodies where the transport supports content updates (else append the
groomed spec as a comment and say so), create/close tickets for splits and merges with
cross-reference comments, and post one short human-facing comment per changed ticket —
what was clarified or restructured, and any open questions. Plain language, no brigade
jargon, no local paths. Leave statuses untouched except: a ticket with unresolved open
questions moves to the blocked-equivalent status only if the user confirms.

## 6. Report and iterate

End each round with: the feature clusters, tickets groomed, splits/merges applied,
tickets with open questions, corrections the scouts made to codebase claims, and which
tickets you'd recommend cooking first. The user may iterate — re-cluster, re-split,
sharpen further — as many rounds as they want. Clean up `.brigade/grooming/` after the
final report.

Guardrails: originals preserved verbatim; no restructure or status change without
confirmation; open questions are surfaced, never answered by invention; no secrets or
local paths on the board; scouts/inspectors report — only you write to the source; no
cooking from a grooming session.
