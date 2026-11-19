---
title: Design and UI
description: Get a ticket's design to ready before anyone cooks it, with a design swag ledger or a live UI loop in your browser.
---

Two modes shape a ticket before it is cooked. **Design swag** writes a first cut of what the ticket will take as a ledger of decisions and open questions. The **UI loop** iterates a front-end ticket live in your browser and captures the agreed screens. Neither claims the ticket or dispatches a cook.

## Choose a mode

| You want | Use |
| --- | --- |
| A first estimate of a ticket's shape and the questions blocking it | Design swag: `/brigade:design` |
| To settle one open design question | Design swag revisit: `/brigade:design <ticket-id> <question-name>` |
| Agreed screens and a text spec for a front-end ticket | UI loop: `/brigade:ui` |

## Swag a design

Run `/brigade:design <ticket-id>`, or say `swag this ticket`, `flesh out the design` or `revisit the design`. Without a ticket id it asks for one.

### The first pass

With no `DESIGN.md` for the ticket yet, the design agent:

1. Reads the ticket once.
2. Sends a few scouts to ground the swag (where does this live, which contracts, which tests), capped by your tier.
3. Writes `.brigade/dishes/<dish-slug>/DESIGN.md` as a ledger:
   - `## Decisions so far`: one line per decision with a pointer to its evidence (empty on the first pass).
   - `## Open questions`: each one named and typed as `research`, `grilling`, `prototype` or `task`.
   - `## Not yet specified`: gaps too foggy to state as a precise question yet.
   - `## Out of scope`.
4. Posts a plain-language comment on the board and leaves the ticket in `design` (or `scoping` when only product questions are open).

It prints a readiness verdict, the top open questions and the path to `DESIGN.md`.

### Revisits

Each later run resolves **one** question: the one you name, or else the first with nothing blocking it. Research questions are the exception; every unblocked one is resolved in a single scout wave. How a question gets resolved depends on its type:

| Type | How it is resolved |
| --- | --- |
| `research` | A scout answers it; the decision points at the brief |
| `grilling` | You are asked, one question at a time. The agent never answers for you |
| `prototype` | A throwaway artifact under the dish's `prototypes/` folder |
| `task` | Done directly when it can be, or handed to you as a precise checklist |

The answer moves from Open questions to Decisions so far, sharper gaps graduate into new questions, and readiness is re-scored.

### Readiness

| Value | Meaning |
| --- | --- |
| `insufficient` | Too thin to swag |
| `needs_product` | Product questions block ready |
| `needs_tech` | Contracts, technology or verification are unknown |
| `swaggable` | Enough to estimate the shape, not ready |
| `likely_ready` | Would likely pass after polish; still left in design |

Design swag never claims the ticket, sets `worker`, writes work packets or promotes the ticket to `todo`. Moving it on is your call.

## Run the UI loop

Run `/brigade:ui <ticket-id>` for a front-end ticket. Pass a state name as a second argument to pick up iteration on that state. The loop runs in your own session, because the browser and design tools are yours.

1. **Intake.** It reads the ticket and the project's design language of record (`DESIGN.md` and `.impeccable/design.json`). With no design language yet, it sets one up with you first, and it never invents tokens.
2. **Stand up.** If the app runs, it starts the dev server your repo documents and opens the page in the browser. If there is nothing to run yet, it works on a design canvas instead.
3. **Iterate.** One proposed change at a time, on one named state at a time. Your own edits in the page are applied too.
4. **Capture.** When you say keep it, it screenshots the state as `<state-name>.png` and copies it into the board's UI sample store.
5. **Assets.** Only when the project has a design tool connected; otherwise it skips this and says so on the ticket.
6. **Spec.** For each captured state it writes a text rendering a cook without vision can build from: layout, components, tokens, interactions (including error and empty paths) and accessibility.
7. **Ticket.** It writes `## UI samples` with one `### <state-name>` per state, adds acceptance criteria derived from the states, and posts a plain-language comment. New tokens or components you agreed to are staged in the design language files, never committed.

The ticket moves to `todo` only when you say it is ready; otherwise it stays in `design`. The UI loop never edits product code on the ticket's branch. Throwaway prototypes go under the dish's `prototypes/` folder, and the cooks who later build the ticket get the image paths and the text spec. Samples use fixture data, never real data.

The UI loop leans on companion design skills and browser tools. When one is missing, that step degrades and the loop tells you what to install rather than improvising.

## Worked example: ACME-142

ACME-142 "Add CSV export to the orders page" is in `design`.

1. `/brigade:design ACME-142` runs the first pass. Scouts find the orders query and the existing download endpoints. `DESIGN.md` lands with readiness `needs_product` and three open questions: `include-cancelled-orders` (grilling), `streaming-vs-buffered` (research) and `button-placement` (prototype).
2. `/brigade:design ACME-142 include-cancelled-orders` asks you one question. You answer "exclude them", and the decision is recorded with a pointer to your answer on the board.
3. `/brigade:design ACME-142` resolves `streaming-vs-buffered` with one scout: the existing endpoints buffer, and the largest account has 40,000 orders. Readiness moves to `swaggable`.
4. `/brigade:ui ACME-142` opens the orders page. You iterate two states, `export-idle` and `export-in-progress`, keep both, and the ticket gains `## UI samples` with both screenshots and specs. You say it is ready, and ACME-142 moves to `todo`, ready for `brigade ACME-142`.
