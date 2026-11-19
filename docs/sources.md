---
title: Ticket sources
description: Connect Brigade to Notion, ClickUp, an Obsidian vault or a folder of markdown files, or write an adapter for your own board.
---

Brigade does not own your board. This page lists the boards it works with, explains how
statuses map, and shows what a source needs to provide if you want to plug in your own.

## What a source has to do

A source only has to answer four operations, so anything that can list, read, update and
comment works.

| Op | What it must do |
| --- | --- |
| 1. List my tickets | Return tickets assigned to you, filtered by status |
| 2. Read a ticket | Title, body and comment thread |
| 3. Update status | Move a ticket to a named status, confirmed by re-reading it |
| 4. Post a comment | Append a comment a person on the board can read |

Creating a ticket is optional. Idea intake, grooming splits, handoff follow-ups and roadmap
publishing use it.

The dependency graph never lives in the source. It lives in
`.brigade/dishes/<slug>/PLAN.md`, so the source never models dependencies, waves or work
packets. The full contract is
[`skills/brigade/sources/TEMPLATE.md`](../skills/brigade/sources/TEMPLATE.md).

## Shipped adapters

| Source | File | Transport | Notes |
| --- | --- | --- | --- |
| Local markdown | [`local.md`](../skills/brigade/sources/local.md) | `fs` | A folder of files. No service, no token. The best place to start |
| Obsidian | [`obsidian.md`](../skills/brigade/sources/obsidian.md) | `fs` | The same ops as local, plus vault and workspace conventions |
| Notion | [`notion.md`](../skills/brigade/sources/notion.md) | `mcp` or `curl` | An MCP server is preferred (no token); otherwise `NOTION_TOKEN` |
| ClickUp | [`clickup.md`](../skills/brigade/sources/clickup.md) | `mcp` or `curl` | Statuses are per list; onboarding reads them |
| Workspaces | [`workspaces.md`](../skills/brigade/sources/workspaces.md) | `fs` | Multi-repo: the session runs in a parent folder that is not a git repo, and members are separate repos |

`/brigade:onboard` picks the source and writes the wiring to `.brigade/config.md`.

## Transports

- **`mcp`**: the session already has tools for this service. Preferred, because there is no
  token to manage. Onboarding records which tool runs each operation in `.brigade/config.md`.
- **`curl`**: REST with a token read from an environment variable. The fallback when no MCP
  server is present.
- **`fs`**: files on disk. No credentials at all.

## Map your board's statuses

Brigade thinks in abstract statuses. Your board's own names are mapped once, at onboarding,
in the status mapping section of `.brigade/config.md`:

```text
backlog, scoping, design                     (before work starts)
todo -> in_progress -> in_review -> done     plus blocked (off-ramp)
in_review -> rework -> in_progress           (a reviewer sent it back)
in_review -> merging -> done                 (optional: the Planner lands it)
```

A board with no `rework` status uses its `in_progress` status. Leave `merging` unmapped and
you merge approved PRs yourself.

Tickets move at three moments: first dispatch, handoff and your acceptance. A ticket moves to
`blocked` whenever readiness fails and only you can unblock it. Work items live in
`PLAN.md`, not on the board. A reviewer or you move a ticket to `rework` or `merging`, and
Brigade picks it up from there.

## Roadmap tickets

When `/brigade:roadmap` publishes a roadmap, each epic and leaf becomes its own top-level
ticket, never a subtask. Every source writes the roadmap context as the first line under the
ticket's `## Context` heading:

```text
Roadmap: <slug>/<node-id> | <epic title> > <parent title> | satisfies <R-ids> | blocked by <ticket ids>
```

That line is the portable record. Native relations such as blocks, parent links and labels
are optional and adapter-specific.

Markdown boards (local and Obsidian) also carry the roadmap in frontmatter. Every key is
optional and left out when unused:

| Key | Holds |
| --- | --- |
| `roadmap` | the roadmap slug the ticket belongs to |
| `node` | the roadmap node id, an epic or a leaf |
| `epic` | the id of the epic the node sits under |
| `parent_ticket` | the ticket id of the parent ticket, always a top-level ticket |
| `blocked_by` | a list of ticket ids this ticket waits on |
| `satisfies` | a list of requirement ids (R-ids) this ticket delivers |

See [Roadmaps](roadmap.md) for how the graph is built and published.

## Write your own adapter

Copy `skills/brigade/sources/TEMPLATE.md` to `skills/brigade/sources/<name>.md`, answer the
four operations for your service, and set `source: <name>` in `.brigade/config.md`. A new
adapter needs no code: the file is instructions, and the transport is whatever MCP tools or
CLI the session already has.

Two rules that are easy to miss:

- **Re-read before you write.** You may have edited the ticket in the board's own UI since
  Brigade last read it.
- **Fail loudly with the exact path or id.** A silently skipped ticket with an unknown status
  is worse than a stopped run.

## Use OpenSpec changes as ticket input (experimental)

A ticket may point at an OpenSpec change folder, `openspec/changes/<name>/`. Brigade reads
the files as plain markdown and needs no CLI and no adapter:

- `proposal.md`: `## Why` and `## What Changes` become the ticket's goal.
- Delta specs (`specs/<capability>/spec.md`): each `#### Scenario:` with its WHEN and THEN
  bullets is an acceptance criterion and a contract-test case.
- `tasks.md`: a hint for the plan's `## Proposed breakdown`, never a second plan. `PLAN.md`
  stays the one plan.
- `design.md`: its decisions feed the decision record.

Brigade never runs `openspec archive`; you do, because the merge rules for deltas exist only
in the CLI. The formats are as of OpenSpec 2.1.0, which changes often: see E-016 in
[Experiments](experiments.md).

## Comments are for people

Everything Brigade posts to a board is read by people who are not in the session: plain
language, no local paths, no Brigade jargon, no secrets. The internal detail stays in
`.brigade/`, which never leaves your machine.
