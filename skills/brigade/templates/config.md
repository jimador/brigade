# Brigade config — <repo or workspace name>

<!-- Copied to .brigade/config.md at init. Fill every value; the Planner reads this file
     first on every dish. Keep it out of git (.git/info/exclude has .brigade/). -->

## Source

- source: obsidian          # notion | clickup | local | obsidian — matches a file in sources/
- transport: fs             # mcp (session's MCP server) | curl (REST + token) | fs (local/obsidian)
- database_id: <uuid-or-path>  # notion: database; clickup: list_id; local/obsidian: board_dir path
- workspace_id: <id>        # optional; when set with obsidian, list across tickets/<id>/* boards
- team_id: <id>             # clickup only
- user_id: <uuid>           # HUMAN operator on mcp/curl sources
- user: <your-handle>               # local/obsidian assignee frontmatter value
- token_env: NOTION_TOKEN   # curl only; unused for mcp/fs

### MCP tool map (transport: mcp only — actual tool names from this session)

- list_tickets: <e.g. notion-query-data-source / search>
- read_ticket: <e.g. notion-fetch>
- update_status: <e.g. notion-update-page>
- post_comment: <e.g. notion-create-comment>
- create_ticket: <e.g. notion-create-pages, optional>

### Property names (as this board spells them)

- title_property: Name
- status_property: Status
- assignee_property: Assignee
- kind_property: kind           # optional custom field / frontmatter
- worker_property: worker       # optional; set on dispatch only

### Status mapping (abstract → native)

- backlog: backlog
- scoping: scoping
- design: design
- todo: todo
- in_progress: in_progress
- in_review: in_review
- done: done
- blocked: blocked

## Repo

- main_branch: main
- tier: two-star           # three-star | two-star | one-star — see TIERS.md
- verification_gate:        # exact commands a Cook must run and paste output from
  - <e.g. bun run types>
  - <e.g. bun run test>
- test_convention: <one line>
- remote_pr: true
- graphite_restack: false
- graphite_platform: false

## Local conventions (optional, prepended to every work packet)

- <e.g. "imports at top of file, never inline">
