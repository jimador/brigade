# 0004: Record a ruling on every PR comment and every out-of-scope note

## Context

Two kinds of notes get lost today. When a dish comes back from PR review, each actionable
comment needs a decision, but nothing records one, so a comment can go unanswered and nobody
notices until the reviewer asks again. At handoff, cook reports and verdicts list things they
noticed but left alone under `## Out of scope`; nothing makes anyone decide what happens to
each one, so most of them are never filed and never seen again.

## Decision

PLAN.md gets two ruling tables, checked the same way as `## Plan-check dispositions`:

- `## PR feedback`, columns `id | where | ruling | reply`, one row per actionable review
  comment. The ruling is `accept`, `clarify` or `push-back`, and `reply` is what was posted on
  the thread.
- `## Follow-ups`, columns `id | source | ruling | ticket`, one row per out-of-scope note. The
  ruling is `filed`, `covered` or `dropped`, and `ticket` names the ticket or the reason.

`brigade-validate` fails a row with an unknown ruling, an empty `reply` or `ticket`, a
repeated id, or no `PR<k>` / `FU<k>` id. A plan without either section is not checked, and a
`kind: research` plan skips both.

## Use cases

- A dish back from review: the planner adds one `## PR feedback` row per comment, posts the
  reply, and turns the `accept` rows into rework packets. The table shows at a glance that
  every comment got an answer.
- A dish at handoff with out-of-scope notes: the planner reads each cook report and verdict,
  adds one `## Follow-ups` row per note, and files a ticket or writes down why not before the
  dish is closed.

## Alternatives rejected

- A separate artifact file per review sweep or handoff pass. The resume path would have to
  find and read those files too, and a dish could end up with several that disagree.
- Prose notes in the plan. They are easy to write, but no check can tell whether every comment
  or note got a decision.

## Consequences

- The handoff and re-entry text in later items writes these tables; this change only defines
  them and makes the validator gate them.
- Plans written before this change have neither section and validate exactly as before.
