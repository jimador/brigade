# 0001: Add `rework` and an optional `merging` ticket status

## Context

Brigade moves a ticket up to `in_review` and stops there. When a reviewer asks for changes on
the pull request, there is no defined way for the ticket to come back into the fleet's hands, so
returned work either sits in review or gets pushed back to `in_progress` by hand. Landing a pull
request a human has approved is also manual: nothing on the board says "this one is cleared to
merge".

## Decision

Add two abstract ticket statuses.

- `rework`: a reviewer sent the pull request back. It is active in the config template by
  default. A board that has no such status maps it to `in_progress`.
- `merging`: a human approved the pull request and the planner may land it. It is optional and
  ships commented out in the template; while it stays absent, the human merges by hand.

The config template's status mapping and the ticket schema list the same set, and a test keeps
the two in step.

## Use cases

- A reviewer requests changes on a pull request. The ticket moves to `rework`, and the planner
  picks it up again as returned work rather than as a fresh start.
- A human approves a pull request on a team that has opted in to `merging`. They move the ticket
  to `merging`, and the planner lands the pull request.

## Alternatives rejected

- Reusing `in_progress` for rework. The board could no longer tell new work from work a reviewer
  returned, so neither people nor the planner could see which tickets carry review feedback.
- A config flag that lets the planner land approved pull requests, instead of a status. The
  human's approval has to be visible on the board, per ticket; a global flag hides it.

## Consequences

- The source adapters, the board lanes and the handoff text must learn both names. Later work
  items cover each of them.
- Existing configs were written before these lines existed. An absent `rework` line means the
  identity mapping first, and the `in_progress` fallback when the board has no such status. An
  absent `merging` line means the human keeps merging by hand.
