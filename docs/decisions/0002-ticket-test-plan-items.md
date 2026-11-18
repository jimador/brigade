# 0002: Copy a ticket's test plan into the plan as owned `TP<k>` items

## Context

When a ticket author writes a `Validation`, `Test plan` or `Testing` section, that list is what
the human will check before accepting the work. The planner reads the ticket and writes its own
acceptance criteria per packet, and along the way it can paraphrase an item until it means
something weaker, or drop it entirely. Nothing in the plan showed which of the author's checks
had landed in a packet, so a missing one surfaced only at review, as rework.

## Decision

The planner copies each item of the ticket's test plan word for word into PLAN.md, under
`### Ticket test plan` inside `## Dish`, as one line `- [ ] TP<k>. <the item>`, numbered from 1.
Every `TP<k>` must appear in at least one packet's `### Acceptance criteria`, so each check has
an owner. `brigade-validate` fails a line with no id, a duplicate id, and an id no packet owns;
at `level: contracts`, where implementation packets may not exist yet, an unowned id is a
warning instead.

## Use cases

- A ticket has a Test plan section with three items. The plan's `## Dish` lists `TP1` to `TP3`
  verbatim, and each packet's acceptance criteria cite the ids it is responsible for. If the
  planner forgets `TP3`, the validator names it before any cook is dispatched.
- A ticket has no test plan. The plan has no `### Ticket test plan` subsection, and the
  validator checks nothing new.

## Alternatives rejected

- Free-text matching between the ticket's items and the packets' acceptance criteria. There are
  no ids to match on, and a paraphrase is exactly what the rule is meant to catch, so fuzzy
  matching would pass the very cases it should fail.
- A frontmatter count of test plan items. The planner writes that number too, so it can be set
  wrong in the same way the items get dropped, and a count says nothing about which check is
  missing.

## Consequences

- The planner numbers the ticket's test plan items at intake, and packets cite those ids in
  their acceptance criteria.
- The copy in PLAN.md is only as faithful as the planner made it. A later `--ticket` check can
  count the ticket file's items against the `TP<k>` lines to close that gap.
