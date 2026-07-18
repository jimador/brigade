# Source adapter: ClickUp

Implements the four source operations (see `TEMPLATE.md`) against ClickUp. Two transports,
picked once at init and recorded in `.brigade/config.md`:

- **`mcp` (preferred when present):** the session's ClickUp MCP server. Map each operation
  to the closest tool (task get/update, comment create, task search) under `mcp_tool_map`
  in config and verify with one cheap read (fetch the target list's statuses). The curl
  ops below are the specification for what each MCP call must accomplish.
- **`curl` (fallback):** ClickUp REST API v2 with a personal token in `CLICKUP_TOKEN`.
  All requests: `-H "Authorization: $CLICKUP_TOKEN" -H "Content-Type: application/json"`.
  Never echo the token, never write it to disk.

## Prerequisites

Config values (in `.brigade/config.md`):

- `list_id` — the working list.
- `team_id` — the workspace id (for the task-search endpoint).
- `user_id` — the human operator's ClickUp member id
  (`curl -s https://api.clickup.com/api/v2/team -H "Authorization: $CLICKUP_TOKEN" | jq '.teams[].members[].user | {id, username}'`).
- The status-name mapping for `todo / in_progress / in_review / done / blocked`.
  **Statuses are per-list in ClickUp** — discover the native names at init:

```bash
curl -s "https://api.clickup.com/api/v2/list/$LIST_ID" \
  -H "Authorization: $CLICKUP_TOKEN" | jq -r '.statuses[].status'
```

Init smoke test: the status read above. If it 401s, the token is bad; if the list has no
status matching your mapping, fix the mapping before anything else — a write with an
unknown status name fails loudly, but a wrong-but-existing name is a silent misroute.

## Op 1 — List my tickets

```bash
curl -s "https://api.clickup.com/api/v2/team/$TEAM_ID/task?assignees%5B%5D=$USER_ID&list_ids%5B%5D=$LIST_ID&statuses%5B%5D=$TODO_STATUS" \
  -H "Authorization: $CLICKUP_TOKEN" \
  | jq -r '.tasks[] | "\(.id)  \(.name)"'
```

Ticket **id** = the task id. Ticket **key** for branch names = the id verbatim (ClickUp ids
are branch-safe), e.g. `brigade/86aj7qt64/integration`. Intake sweep variant: drop the
status filter.

## Op 2 — Read a ticket

```bash
# Task (title, description, status, custom fields, subtasks)
curl -s "https://api.clickup.com/api/v2/task/$TASK_ID?include_subtasks=true" \
  -H "Authorization: $CLICKUP_TOKEN" | jq '{name, description, status: .status.status, subtasks: [.subtasks[]? | {id, name}]}'

# Comments
curl -s "https://api.clickup.com/api/v2/task/$TASK_ID/comment" \
  -H "Authorization: $CLICKUP_TOKEN" | jq -r '.comments[] | "- " + .comment_text'
```

## Op 3 — Update status

```bash
jq -n --arg s "$NATIVE_STATUS_NAME" '{status: $s}' \
  | curl -s -X PUT "https://api.clickup.com/api/v2/task/$TASK_ID" \
      -H "Authorization: $CLICKUP_TOKEN" -H "Content-Type: application/json" -d @- \
  | jq -r '.status.status'
```

Send the **native** name from the config mapping; confirm the echoed status matches. A
mismatch means the mapping is wrong — fix config, don't retry blindly.

## Op 4 — Post a comment

```bash
jq -n --arg text "$COMMENT_TEXT" '{comment_text: $text}' \
  | curl -s -X POST "https://api.clickup.com/api/v2/task/$TASK_ID/comment" \
      -H "Authorization: $CLICKUP_TOKEN" -H "Content-Type: application/json" -d @-
```

Comments are read by humans on the board: plain language, what/why/how-verified, no local
paths, no brigade jargon, no secrets. Build JSON with `jq -n --arg`.

## Optional — Create a ticket (idea intake / grooming splits)

```bash
jq -n --arg name "$TITLE" --arg status "$TODO_STATUS" --argjson uid "$USER_ID" \
  '{name: $name, status: $status, assignees: [$uid]}' \
  | curl -s -X POST "https://api.clickup.com/api/v2/list/$LIST_ID/task" \
      -H "Authorization: $CLICKUP_TOKEN" -H "Content-Type: application/json" -d @- | jq -r '.id'
```

Put the spec in `description` (markdown supported via `markdown_description`).

## Known gotchas (verified)

- Statuses are per-list; always resolve the mapping against the actual target list.
- API @mentions/assignment do not reliably notify humans — anything needing attention gets
  said out loud to the user in session, not just written to ClickUp.
- Subtasks come back only with `include_subtasks=true`; grooming folds them into the
  parent.
