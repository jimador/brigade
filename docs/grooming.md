---
title: Groom a board
description: Turn a messy backlog into feature-clustered, cook-ready tickets, one confirmed batch at a time, without cooking anything.
---

Grooming takes a whole board and sharpens it until its tickets are organized by product feature and ready to cook. It is a conversation: every change is a proposal you confirm, and nothing is ever dispatched to cooks.

## When to groom

Groom when you hand Brigade a board instead of one ticket, or when tickets predate Brigade and read like notes. Say any of these:

- `groom my board`
- `organize my tickets`
- `break down this feature`
- `clean up the backlog`
- `split this ticket` or `merge these tickets`

Grooming needs a configured board, so run `/brigade:onboard` first in a new repo. It works on any supported board: Notion, ClickUp, an Obsidian vault or a local folder of markdown tickets (see [Sources](sources.md)).

To cook one ticket, skip grooming and [run a dish](usage.md). To shape an initiative bigger than a board, start with a [roadmap](roadmap.md).

## What a round looks like

A round has six steps, and the Planner ticks them off as it goes:

1. **Collect.** Every open ticket assigned to you, one line each. You exclude any you want left alone. Child tasks fold into their parent and are never groomed on their own.
2. **Organize.** The Planner looks at the whole set before touching any one ticket. It clusters tickets by the product feature they serve (named in your product's language), flags duplicates as merge candidates and multi-behavior tickets as split candidates, and proposes an order by product value. You iterate on this shape until you like it.
3. **Review.** Two passes per ticket, in parallel where they are independent. A scout checks which files and contracts the ticket really touches and whether its claims about the code hold. An inspector reads the ticket as a work contract: is the goal one outcome, is each criterion checkable, what boundary is missing. Both are advisory: no pass or fail.
4. **Rewrite.** The Planner drafts each groomed body from the original, the brief and the findings.
5. **Update.** You see every groomed body and every split, merge and regroup as a compact before and after, and give **one confirmation for the whole batch**. Only then does the board change.
6. **Report.** Feature clusters, tickets groomed, splits and merges applied, tickets with open questions, code claims the scouts corrected, and which tickets to cook first.

Run as many rounds as you like: re-cluster, re-split, sharpen further.

## What a groomed ticket contains

| Section | What goes in it |
| --- | --- |
| `## Goal` | One outcome, sharpened from the original |
| `## Context` | Real file paths and anchors from the scout, with corrected assumptions and unverified claims marked |
| `## Acceptance criteria` | Checkboxes, each one observable |
| `## Constraints` and `## Out of scope` | Boundaries from the findings and the original text |
| `## Proposed breakdown` | Only when the ticket had child tasks: one bullet per child, with files and warnings. A hint for the Planner, not a plan |
| `## Original request` | Your original text, verbatim, at the bottom |

A genuine open question (ambiguous scope, an undefined value, contradictory requirements) goes at the top under **Open questions**, phrased so you can answer it with options and a recommendation. That ticket stays out of the ready status.

## What grooming never does

- **Never cooks.** No work packets, no branches, no cooks. A dish starts only when you name a groomed ticket and say go.
- **Never invents an answer.** Open questions are surfaced, not filled in.
- **Never destroys your text.** The original request is preserved verbatim, and a merge keeps both bodies.
- **Never changes the board without your confirmation.** Restructures and status changes wait for your yes. A ticket with open questions moves to blocked only if you confirm it.
- **Never puts local paths, secrets or Brigade jargon on the board.** Each changed ticket gets one short plain-language comment.
- **Never overwrites a ticket someone else holds.** If another Claude or Codex session holds that ticket's lease, the ticket is left unchanged and reported to you.

Scouts and inspectors only report; the Planner is the only one that writes to the board. Their working files live under `.brigade/grooming/` and are removed when the session ends.

## Worked example: the orders backlog

You say `groom my board`. Five tickets come back, including ACME-142 "Add CSV export to the orders page and fix the date filter" and ACME-150 "Orders export".

1. **Organize.** The Planner proposes one cluster, "Order reporting", and flags ACME-142 as a split candidate (two behaviors joined by "and") and ACME-150 as a duplicate of its export half.
2. You confirm. ACME-142 keeps the export and becomes "Add CSV export to the orders page"; a new sibling takes the date filter, cross-referencing the original. ACME-150 is merged into ACME-142 and closed with a comment pointing at it.
3. **Review.** The scout finds the orders query lives in `src/orders/query.ts`, not the controller the ticket names, and corrects the context. The inspector flags "export works for large orders" as uncheckable.
4. **Rewrite.** That criterion becomes "an export of 10,000 orders finishes and the file has 10,001 lines". An open question goes on top: should cancelled orders be included (options: yes, no, a toggle; recommendation: no).
5. **Update.** One confirmation and the board changes. The report recommends cooking ACME-142 first once the cancelled-orders question is answered.
