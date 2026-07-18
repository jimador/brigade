# Ticket sources

Brigade does not own your board. A source only has to answer four questions, so anything
that can list, read, update, and comment works — Notion, ClickUp, an Obsidian vault, a
folder of markdown files, or something you write yourself.

The dependency DAG deliberately does **not** live in the source. It lives in
`.brigade/dishes/<slug>/PLAN.md`, so the source never needs to model dependencies, waves,
or work packets.

## The four operations

| Op | What it must do |
| --- | --- |
| 1. List my tickets | Return tickets assigned to the operator, filtered by status |
| 2. Read a ticket | Title, body, and comment thread |
| 3. Update status | Move a ticket to a named status, confirmed by re-read |
| 4. Post a comment | Append a comment a human on the board can read |

Creating a ticket is optional — used by idea intake and grooming splits.

Full contract: [`skills/brigade/sources/TEMPLATE.md`](../skills/brigade/sources/TEMPLATE.md).

## Shipped adapters

| Source | File | Transport | Notes |
| --- | --- | --- | --- |
| Local markdown | [`local.md`](../skills/brigade/sources/local.md) | `fs` | A folder of files. No service, no token. Best place to start |
| Obsidian | [`obsidian.md`](../skills/brigade/sources/obsidian.md) | `fs` | Same ops as local, plus vault and workspace conventions |
| Notion | [`notion.md`](../skills/brigade/sources/notion.md) | `mcp` or `curl` | MCP server preferred (no token); otherwise `NOTION_TOKEN` |
| ClickUp | [`clickup.md`](../skills/brigade/sources/clickup.md) | `mcp` or `curl` | Statuses are per-list; init reads them |
| Workspaces | [`workspaces.md`](../skills/brigade/sources/workspaces.md) | — | Multi-repo: session cwd is a non-git parent, members are separate repos |

## Transports

- **`mcp`** — the session already has tools for this service. Preferred: no token to
  manage. Init records the operation-to-tool mapping in `.brigade/config.md`.
- **`curl`** — REST with a token from an environment variable. The fallback when no MCP
  server is present.
- **`fs`** — files on disk. No credentials at all.

## Status mapping

Brigade thinks in five abstract statuses. Your board's native names are mapped once, at
init, in `.brigade/config.md`:

```
todo → in_progress → in_review → done       plus  blocked (off-ramp)
```

Tickets move at exactly three moments — first dispatch, handoff, and human accept — plus
`blocked` whenever readiness fails and only you can unblock. Work items live in `PLAN.md`,
not on the board, unless a work item happens to also be a board subtask; those move live,
never batched.

## Writing your own adapter

Copy `sources/TEMPLATE.md` and answer the four operations for your service. A new adapter
needs no code — the adapter file is instructions, and the transport is whatever MCP tools
or CLI the session already has.

Two rules that are easy to miss:

- **Re-read before you write.** The operator may have edited the ticket in their own UI
  since you last read it.
- **Fail loudly with the exact path or id.** A silently skipped ticket with an unknown
  status is worse than a stopped run.

## Comments are for humans

Everything brigade posts to a board is read by people who are not in the session: plain
language, no local paths, no brigade jargon, no secrets. The internal detail lives in
`.brigade/`, which never leaves your machine.
