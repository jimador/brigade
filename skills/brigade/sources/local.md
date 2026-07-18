# Source adapter: local (a folder of markdown files)

Implements the four source operations (see `TEMPLATE.md`) against a plain directory of
markdown files — no service, no token. Use it for repos without a board, offline work, or
trying brigade before wiring Notion/ClickUp. Text files **are** the board. For Obsidian
vault dashboards, prefer `sources/obsidian.md` (same fs ops + workspace rules).

## Prerequisites

Config values (in `.brigade/config.md`):

- `board_dir` — the ticket directory (default `tasks/`; may be committed in the repo or
  live anywhere on disk). Absolute vault paths are fine.
- `user` — the operator's name as used in `assignee` frontmatter.
- Status mapping is identity by default:
  `backlog | scoping | design | todo | in_progress | in_review | done | blocked`.

One markdown file per ticket:

```markdown
---
id: auth-regression        # defaults to the filename without .md
title: Fix auth regression on token refresh
status: todo               # backlog|scoping|design|todo|in_progress|in_review|done|blocked
assignee: alex
kind: feature              # required before cook when the board uses kind
worker: ""                 # set on dispatch only
created: 2026-07-06
---

## Goal
...body per the ticket schema (SCHEMAS.md)...

## Activity

- 2026-07-06T18:40Z [planner] Split from "auth cleanup" during grooming.
```

`## Activity` is the comment thread: append-only, one `- <ISO timestamp> [<author>] <text>`
line per comment. Everything above it is the ticket body; grooming may rewrite it but the
`## Original request` section is always preserved.

Init smoke test: Op 1 (list) returns without error on `board_dir`.

## Op 1 — List my tickets

Glob `<board_dir>/*.md`, parse frontmatter, filter `assignee == user` and `status == todo`
(drop the status filter for the intake sweep; include `backlog`/`scoping`/`design` when
grooming or designing). Ticket **id/key** = the `id` frontmatter (or filename) — already
branch-safe kebab-case: `feat/auth-regression` delivery naming.

## Op 2 — Read a ticket

Read the file: frontmatter = fields, body = description, `## Activity` = the thread.

## Op 3 — Update status

Edit the `status` frontmatter key. Confirm by re-reading. An unknown status value in any
file is reported precisely (file + value), never skipped.

## Op 4 — Post a comment

Append a timestamped line to `## Activity` (create the section if missing). Never rewrite
existing Activity history.

## Optional — Create a ticket

Write a new file with the frontmatter above (slugified title as filename); refuse to
overwrite an existing file. Used by idea intake and grooming splits.

## Claim / Design

- Cook path: set `assignee`, ensure `kind`, move `todo` → `in_progress`; set `worker` on
  dispatch.
- Design swag: never change assignee/worker; leave status in `design` or `scoping`.

## Adapter rules

- Re-read a file before writing it (the operator may have edited it).
- If `board_dir` is inside a git repo, ticket changes are ordinary diffs — commit them with
  the work. Never commit tickets containing secrets.
- A missing `board_dir` or a file without frontmatter fails loudly with the exact path.
