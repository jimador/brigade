# Source adapter: Notion

Implements the four source operations (see `TEMPLATE.md`) against Notion. Two transports,
picked once at init and recorded in `.brigade/config.md`:

- **`mcp` (preferred when present):** the session's Notion MCP server. Auth is already
  handled, and structured tools beat hand-rolled JSON. Detect it at init by listing the
  session's available tools for Notion ones (typically named like `notion-search`,
  `notion-fetch`, `notion-update-page`, `notion-create-comment`, `notion-get-comments` —
  exact names vary by server version). If found, map each of the four operations below to
  the closest tool, record that mapping under `mcp_tool_map` in config, and verify with one
  cheap read (fetch the task database). Semantics stay identical to the REST ops below —
  the curl commands double as the specification for what each MCP call must accomplish
  (filter by assignee + status, set the native status name, post plain-text comments).
- **`curl` (fallback, always works):** plain `curl` + `jq` against the REST API, as
  specified below. Use when no Notion MCP tools are in the session (headless runs, CI,
  minimal installs).

If the configured transport is `mcp` but the tools are missing from the current session,
fall back to `curl` for the run (provided `NOTION_TOKEN` is set) and note the fallback to
the user once — don't silently flip the config.

## Prerequisites

- **Token (curl transport only):** a Notion internal integration token in the
  `NOTION_TOKEN` environment variable. Create one at notion.so/my-integrations, then share
  the task database with the integration (database page → `...` → Connections → add the
  integration). Never echo the token, never write it into any file. The MCP transport
  needs no token — its server carries its own auth.
- **Config values** (in `.brigade/config.md`), needed on both transports:
  - `database_id` — the task database's UUID (from its URL: the 32-hex segment before `?v=`).
  - `user_id` — the *human operator's* Notion user UUID (MCP: a users/get-self style tool
    or a people-property read gives it). Note: on the curl transport `/v1/users/me` returns
    the **bot**, not the human. Find the human once at init:

```bash
curl -s https://api.notion.com/v1/users \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  | jq -r '.results[] | "\(.id)  \(.name)  \(.type)"'
```

  - Property names as they appear in this database — defaults assume `Status` (status
    type), `Assignee` (people type), `Name` (title). Adjust in config if the board differs.
  - The status-name mapping (native names for `todo / in_progress / in_review / done /
    blocked`). Discover native options at init:

```bash
curl -s "https://api.notion.com/v1/databases/$DATABASE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  | jq '.properties.Status.status.options[].name'
```

All requests use headers:
`-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" -H "Content-Type: application/json"`.

If a request 404s on a page the user can clearly see, the integration isn't connected to
that page/database — fix sharing before anything else. If the workspace uses the newer
data-source API and database query 400s, retry the same query against
`/v1/data_sources/<id>/query` with `Notion-Version: 2025-09-03`.

## Op 1 — List my tickets

```bash
curl -s "https://api.notion.com/v1/databases/$DATABASE_ID/query" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "and": [
      { "property": "Assignee", "people": { "contains": "'$USER_ID'" } },
      { "property": "Status", "status": { "equals": "'$TODO_STATUS'" } }
    ]},
    "page_size": 25
  }' | jq -r '.results[] | "\(.id)  \(.properties.Name.title[0].plain_text // "(untitled)")"'
```

Ticket **id** = the page UUID. Ticket **key** for branch names = first 8 chars of the UUID
(no dashes), e.g. `brigade/a1b2c3d4/integration`. For the intake sweep, run the same query
without the status clause to see everything assigned to the user.

## Op 2 — Read a ticket (title, body, comments)

```bash
# Properties (title, status, assignee, any acceptance-criteria fields)
curl -s "https://api.notion.com/v1/pages/$PAGE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" | jq '.properties'

# Body blocks → readable text
curl -s "https://api.notion.com/v1/blocks/$PAGE_ID/children?page_size=100" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  | jq -r '.results[] | .. | .plain_text? // empty'

# Comments
curl -s "https://api.notion.com/v1/comments?block_id=$PAGE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  | jq -r '.results[] | "- " + ([.rich_text[].plain_text] | join(""))'
```

If the body has nested blocks (toggles, columns), fetch children of those block ids the
same way — but only when the top level clearly truncates something relevant.

## Op 3 — Update status

```bash
curl -s -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{ "properties": { "Status": { "status": { "name": "'$NATIVE_STATUS_NAME'" } } } }' \
  | jq -r '.properties.Status.status.name'
```

Always send the **native** status name from the config mapping. Confirm the echoed name
matches what you set; a silent mismatch means the mapping is wrong — fix config, don't
retry blindly.

## Op 4 — Post a comment

```bash
jq -n --arg pid "$PAGE_ID" --arg text "$COMMENT_TEXT" \
  '{ parent: { page_id: $pid }, rich_text: [ { text: { content: $text } } ] }' \
| curl -s -X POST "https://api.notion.com/v1/comments" \
    -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" -d @-
```

Comments are read by humans on the board: plain language, what/why/how-verified, no local
paths, no brigade jargon, no secrets. Build the JSON with `jq -n --arg` as shown so
quotes/newlines in the text can't break the payload.

## Optional — Create a ticket (idea intake)

```bash
jq -n --arg db "$DATABASE_ID" --arg title "$TITLE" --arg todo "$TODO_STATUS" --arg uid "$USER_ID" \
  '{ parent: { database_id: $db },
     properties: {
       Name: { title: [ { text: { content: $title } } ] },
       Status: { status: { name: $todo } },
       Assignee: { people: [ { id: $uid } ] } } }' \
| curl -s -X POST "https://api.notion.com/v1/pages" \
    -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" -d @- | jq -r '.id'
```

Put the spec/acceptance criteria in a follow-up `PATCH /v1/blocks/<page_id>/children` call
with paragraph blocks, or simply as the first comment.
