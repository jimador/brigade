---
title: Commands
description: Every Brigade slash command and skill trigger phrase, with arguments, an example, and what each one never does.
---

This page lists every slash command the plugin ships and the phrases that start its skills. Use the table to find the right command, then read its section for arguments, an example, and the limits it keeps.

## All commands at a glance

| Command | What it does | Arguments | Changes files? |
| --- | --- | --- | --- |
| `/brigade:status` | Snapshot of tier, dishes, worktrees, leases and efficiency | none | no |
| `/brigade:config` | Shows the resolved configuration, layer by layer | none | no |
| `/brigade:tier` | Shows or sets the repo's service tier | `[three-star\|two-star\|one-star]` | only the `tier` line |
| `/brigade:validate` | Checks dish and roadmap artifacts against the schemas | none | no |
| `/brigade:onboard` | Sets up Brigade in a repo, or repairs a setup | none | yes, setup files |
| `/brigade:upgrade` | Brings open tickets and dishes up to the installed version's rules | none | yes, after one confirmation |
| `/brigade:design` | Design swag: writes or revisits a ticket's decision ledger | `[ticket-id] [question-name]` | `DESIGN.md` only |
| `/brigade:ui` | Live UI design loop for a front-end ticket | `[ticket-id] [state-name]` | prototypes and the ticket's UI samples |
| `/brigade:roadmap` | Breaks an initiative into a roadmap of epics down to ready tickets | `[slug] [resume\|refresh]` | the roadmap folder and published tickets |
| `/brigade:review` | Advisory review of a branch, range or PR | `[branch\|range\|PR] [--tier star]` | a review report |
| `/brigade:review-dispatch` | Cooks selected findings from a review report as a mini-dish | `[review-slug\|report-path] [finding-id...]` | yes, through the normal dish flow |
| `/brigade:retro` | Runs the analyst retro on a dish | `[dish-slug] [--standard\|--intensive]` | `analyst.md` and `LEARNINGS.md` |

Commands that only report (`status`, `config`, `validate`) run their scripts before the model sees anything, so the answer comes from script output and costs no exploration. See [Scripts](scripts.md) for the scripts themselves.

## Skill trigger phrases

Brigade's four skills start from plain language. You don't need a slash command for them.

| Skill | Say something like | Arguments | Never does |
| --- | --- | --- | --- |
| `brigade` | "brigade", "brigade heavy", "brigade light", "work my board", "work my tickets", "continue the dish", "parallelize this ticket", "run the fleet", "swag this ticket", "flesh out the design" | `[ticket-id\|dish-slug] [heavy\|light]` | groom a whole board or do first-time setup |
| `groom` | "groom my board", "organize my tickets", "break down this feature", "clean up the backlog", "split or merge tickets", or hand over a whole board | `[board\|feature]` | cook: a dish starts only when you pick a groomed ticket and say go |
| `roadmap` | "plan a migration", "roadmap this", "break this initiative down", "drill down the roadmap", "resume the roadmap" | `[slug] [resume\|refresh]` | cook: a dish starts only when you pick a published leaf |
| `onboard` | "set up brigade", "onboard this repo", "repair brigade setup", "finish board wiring", "upgrade my open work", "upgrade the tickets after an update" | none | work tickets or groom a board |

"brigade heavy" runs the dish at three-star and "brigade light" at one-star; plain "brigade" uses the repo's tier (two-star by default). See [Tiers](tiers.md).

The plugin also registers `/brigade-board`, which opens the live task board in a pane. See [Running a dish](usage.md).

## /brigade:status

Prints a snapshot of Brigade's state: the active tier, each dish's items by status, worktrees, coordination leases, and efficiency numbers. Anything stuck is flagged: blocked or rework items, stale worktrees, leases that need a look.

Arguments: none.

```text
/brigade:status
```

Never does: re-read dish artifacts. The output of `brigade-status` and `brigade-coord list` is the whole answer.

## /brigade:config

Shows which config layer files exist, the settings that differ from the built-in defaults and which layer set each, any prompt overrides in play, and any validation problems with the file and the fix.

Arguments: none.

```text
/brigade:config
```

Never does: read the config files itself. It summarizes `brigade-config layers`, `resolve`, `prompts` and `doctor`. See [Configuration](configuration.md) and [Overrides](overrides.md).

## /brigade:tier

With no argument, reports the active tier from `.brigade/config.md` (a missing key means two-star) and its one-line meaning. With a valid tier, writes the `- tier:` line in the `## Repo` section and confirms old to new.

Arguments: `three-star`, `two-star` or `one-star`. Anything else lists the three valid tiers and changes nothing.

```text
/brigade:tier three-star
```

Never does: touch any line other than `tier`. You run it yourself: the model can't invoke it on its own.

## /brigade:validate

Runs `brigade-validate` over every dish and roadmap under `.brigade/` and leads with the verdict. On a failure it lists each offending artifact with its finding and names the producer (planner, scout, cook, inspector or analyst) that must write it again.

Arguments: none.

```text
/brigade:validate
```

Never does: edit an artifact to silence a finding. See [Artifacts](artifacts.md).

## /brigade:onboard

Sets up Brigade in the current repo, or repairs and upgrades an existing setup. It reads `brigade-onboard status` and `detect`, then follows the onboard skill: scan, plan, interview, execute, verify. It asks only for values it can't detect. See [Installation](installation.md).

Arguments: none.

```text
/brigade:onboard
```

Never does: re-run `status` or `detect` unless you change something the scan already read. Safe to run again: a second pass touches nothing that is already correct.

## /brigade:upgrade

After a plugin update, brings open tickets and dishes up to the installed version's rules. It reads the gap from `brigade-onboard status`, inventories open work, plans the changes, asks you once, applies them, verifies, and records the upgrade. If board wiring is also pending, it finishes onboarding first.

Arguments: none.

```text
/brigade:upgrade
```

Never does: apply changes before your one confirmation.

## /brigade:design

Runs a design swag on one ticket. With no `DESIGN.md` yet it runs a first pass and writes the decision ledger. When `DESIGN.md` exists it revisits one open question, the one you name or the first unblocked one, and re-scores readiness. It prints the readiness verdict, the question it resolved (or the top open questions), and the path to `DESIGN.md`. See [Design and UI](design-and-ui.md).

Arguments: `[ticket-id]` (asks if missing) and an optional `[question-name]`.

```text
/brigade:design ACME-42 storage-format
```

Never does: claim the ticket, set `worker`, decompose, or dispatch cooks.

## /brigade:ui

Runs the designer loop in your session for a front-end ticket: stands up the app or a canvas, iterates one named state at a time in the browser, captures agreed states as UI samples, and leaves the ticket ready for an implementer. It prints the states captured with their sample paths, whether assets were produced, and the ticket status. See [Design and UI](design-and-ui.md).

Arguments: `[ticket-id]` (asks if missing) and an optional `[state-name]` to resume iteration on that state.

```text
/brigade:ui ACME-42 empty-cart
```

Never does: claim as a cook, set `worker`, decompose, or dispatch cooks. The ticket moves to `todo` only when you say it's ready.

## /brigade:roadmap

Runs a roadmap session for one initiative. A new slug starts at the skill's intent step: grill the intent, inventory affected systems with read-only scouts, propose epics, then drill down in confirmed rounds until each leaf is a ready ticket. When it finishes it prints the nodes drilled, leaves ready and published, open questions by name, coverage gaps, and the path to `roadmap.html`. See [Roadmaps](roadmap.md).

Arguments:

- `[slug]`: the roadmap folder under `roadmap_dir` (default `.brigade/roadmaps`). Missing means it lists the existing roadmaps and asks.
- `resume`: picks up where the last session stopped, replaying any approved batch first. Also the default when `ROADMAP.md` already exists.
- `refresh`: runs the roll-up and reports, without drilling.

```text
/brigade:roadmap warehouse-migration resume
```

Never does: claim tickets, set `worker`, write work packets, or dispatch cooks.

## /brigade:review

Reviews a branch, commit range or PR along the configured dimensions and writes a report to `.brigade/reviews/<slug>/report.md`. It shows finding counts by severity, the context tier and its disclosure line, the top three to five findings, and the report path. The tier goes up one level when `brigade-risk` says the change should escalate. See [Reviews](reviews.md).

Arguments:

- `[branch|range|PR]`: a ref with `..` is a range, a number, `#<number>` or a PR URL is a PR, anything else is a branch. Asks if missing.
- `--tier <star>`: overrides the configured tier for this review.

```text
/brigade:review feature/checkout-retry --tier three-star
```

Never does: gate anything. Findings are advisory, with no PASS or FAIL. Each finding is shaped like a packet, so you can cook it later with `/brigade:review-dispatch`.

## /brigade:review-dispatch

Turns selected findings from a finished review into a cooked mini-dish. It validates the report first, re-checks any unconfirmed finding against the current main line in a read-only worktree (a refuted finding is dropped), writes one packet per surviving finding, runs the tier's plan check, and executes through the normal dish flow. At handoff it comments on the source ticket, when there is one, naming which findings shipped and which were dropped.

Arguments:

- `[review-slug|report-path]`: a bare slug resolves to `.brigade/reviews/<slug>/report.md`. Anything with a `/` or ending in `.md` is a path.
- `[finding-id...]`: the findings to act on. With none, it asks you to pick from a checklist.

```text
/brigade:review-dispatch feature-checkout-retry F1 F3
```

Never does: dispatch a finding you didn't select (there is no bulk mode), post to a pull request, or expose a local filesystem path.

## /brigade:retro

Runs the analyst retro on a dish and writes `.brigade/dishes/<dish>/analyst.md`. Standard mode scores the dish from its own artifacts. Intensive mode adds every prior retro, the efficiency numbers and the live heuristics, and runs the analyst on Opus. When the report lands, repo-local learnings go into `.brigade/LEARNINGS.md` and any general heuristic is offered to your knowledge base with one yes or no.

Arguments:

- `[dish-slug]`: defaults to the single unfinished dish, else asks.
- `--standard` or `--intensive`: forces the mode. Without a flag, an end-of-dish retro on a three-star dish is intensive and everything else is standard. Mid-dish checkpoints are always standard.

```text
/brigade:retro checkout-retry --intensive
```

Never does: install anything. Tooling proposals from an intensive retro come to you as decisions.
