# Source adapter: Obsidian (vault markdown boards)

Implements the four source operations (see `TEMPLATE.md`) against markdown files in an
Obsidian vault. Same transport as `local.md` (`fs`) — Obsidian is the human UX (Dataview,
Templater, Tasks); Brigade reads frontmatter + body + `## Activity`.

## When to use

- Operator wants tickets in a personal knowledge vault (e.g. `~/vault/tickets/…`).
- Multi-repo **workspaces** (agent cwd at a non-git parent; each child is a git repo).
- No Notion/ClickUp for this workstream.

## Prerequisites

Config values (in `.brigade/config.md` and/or `~/.brigade/workspaces.md`):

- `source: obsidian`
- `transport: fs`
- `board_dir` — absolute path to **one** board folder
  (`~/vault/tickets/<workspace>/<project>/`), **or**
- `workspace_id` — when set, list/groom across every member board under
  `~/vault/tickets/<workspace_id>/` (see `sources/workspaces.md`).

Also: `user` (assignee name), status mapping (identity by default).

## Ticket file shape

One markdown file per ticket (Templater template: `tickets/_templates/ticket.md`):

```markdown
---
id: welcome
title: Welcome — acme/web board
status: backlog               # backlog|scoping|design|todo|in_progress|in_review|done|blocked
assignee: alex
kind: chore                   # feature|bug|chore|docs|research|contract
worker: ""                    # cook roster name; set only on dispatch
workspace: acme
project: assistant
repo: /path/to/acme/web
created: 2026-07-16
---

## Goal
…

## Activity

- 2026-07-16T00:00:00Z [planner] Board seeded.
```

Ignore underscore files (`_board.md`, `_workspace.md`, `_dashboard.md`) when listing tickets.

## Op 1 — List my tickets

Glob `<board_dir>/*.md` (or all member boards when `workspace_id` is set). Parse frontmatter;
filter `assignee == user` and cookable statuses (`todo` by default; include `backlog`/
`scoping`/`design` for grooming/design). Ticket key = `id` or filename stem.

## Op 2 — Read a ticket

Read the file: frontmatter = fields, body above `## Activity` = description, Activity =
thread.

## Op 3 — Update status

Edit `status` frontmatter. Confirm by re-read. Unknown status → fail with path + value.

## Op 4 — Post a comment

Append `- <ISO timestamp> [<author>] <text>` under `## Activity`.

## Optional — Create a ticket

Write a new file; refuse overwrite. Prefer Templater from Obsidian for humans.

## Claim / Design rules

- **Cook path claim:** set `assignee` to the human operator, ensure `kind`, move `todo` →
  `in_progress`. On dispatch set `worker`.
- **Design swag:** never change `assignee` / `worker`; leave status in `design` (or
  `scoping` if gaps are product-only). Never promote to `todo` from a design pass.

## Adapter rules

- Re-read before write (operator may edit in Obsidian).
- Never commit vault tickets that contain secrets.
- Missing `board_dir` / unreadable frontmatter fails loudly with the exact path.
