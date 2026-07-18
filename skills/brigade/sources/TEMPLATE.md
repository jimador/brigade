# Source adapter contract

A brigade ticket source is anything that can answer four questions. To add a source, copy
this file to `sources/<name>.md`, fill in the concrete commands, and set
`source: <name>` in `.brigade/config.md`. The SKILL never talks to a source directly — it
always goes through the active adapter file, so keep each operation copy-paste runnable
(curl/CLI + jq preferred; no servers, no SDKs unless unavoidable).

## Required operations

### Op 1 — List my tickets

Given the operator's identity and the board id, return open tickets assigned to them:
`(ticket_id, title)` pairs, plus how to derive a short **ticket key** that is safe inside a
git branch name (`brigade/<key>/...`). Also describe the wider "everything assigned to me"
variant used by the intake sweep.

### Op 2 — Read a ticket

Given a `ticket_id`, return the full human context: title, body/description, structured
fields worth reading (acceptance criteria, priority), and the comment thread as plain text.

### Op 3 — Update status

Given a `ticket_id` and one of the abstract statuses
`todo / in_progress / in_review / done / blocked`, set the source's **native** status using
the mapping in `.brigade/config.md`. State how to confirm the write took effect.

### Op 4 — Post a comment

Given a `ticket_id` and human-facing text, append it to the ticket's thread. Show a quoting-
safe construction (e.g. `jq -n --arg`) so arbitrary text can't break the payload.

## Optional operations

- **Create a ticket** — used by idea intake so grilled specs become visible board items.
- **Link artifacts** — attach a PR URL to the ticket if the source has a native field for
  it (otherwise the handoff comment carries the link).

## Adapter rules

- **Auth via one env var**, named in the adapter (e.g. `NOTION_TOKEN`). Document how to get
  it at init. Never print it, never write it to disk.
- **Fail loudly and specifically.** For each op, note the most likely failure (bad token,
  unshared board, wrong property name) and its fix. A silent no-op write is the worst bug a
  source adapter can have.
- **One cheap read as the init smoke test** — name which op to use.
- The source holds **tickets, statuses, comments**. It does NOT hold the work-item DAG —
  that lives in `.brigade/dishes/<slug>/PLAN.md`. Don't invent per-source subtask handling.
