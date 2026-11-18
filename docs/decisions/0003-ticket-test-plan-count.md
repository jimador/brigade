# 0003: Count a markdown ticket's test plan against the plan's `TP<k>` lines

## Context

Decision 0002 makes every `TP<k>` line in a plan's `### Ticket test plan` owned by some packet.
That check only sees the lines the planner wrote. If the planner never copied an item from the
ticket, there is no `TP<k>` for it, nothing is unowned, and the plan passes. The missing check
turns up at review, or not at all.

## Decision

`brigade-validate` takes an opt-in `--ticket <ticket.md>` flag. With it, the validator reads the
ticket file, finds the first level 2 or 3 heading named `Validation`, `Test plan` or `Testing`,
counts the unindented list items up to the next heading, and requires the plan to carry exactly
that many `TP<k>` lines. A plan with `TP<k>` lines whose ticket has no such section fails too,
and an unreadable ticket file is a problem. The flag only applies to `doc: plan` files.

## Use cases

- Obsidian and local boards keep each ticket as a markdown file, so the planner passes that file
  with `--ticket` and a dropped item shows up as a count mismatch before any cook is dispatched.
- API boards (GitHub, Linear and the like) have no ticket file on disk, so they skip the flag and
  rely on the ownership check alone.

## Alternatives rejected

- A frontmatter count the planner writes. The planner is the one who drops items, so it can write
  the wrong count just as easily, and the check would agree with the mistake.
- Reading the board from config inside the validator. That ties the validator to every board
  adapter and their storage formats; a file path keeps it a plain file checker.

## Consequences

- The count catches a missing or extra item, not a reworded one; word-for-word copying is still
  the planner's job and the reviewer's to spot.
- The handoff text in a later item runs `--ticket` for markdown boards, so the check happens by
  default where it can.
