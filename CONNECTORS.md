# This plugin reaches ticket boards and an optional knowledge base through pluggable connectors.

Brigade bundles no MCP server of its own. Every external connection is something the
session already has — an MCP server, a CLI, or plain files — and brigade binds to it at
init time in `.brigade/config.md`. This file names those connector categories; the
per-source operation mapping lives in the adapter files under `skills/brigade/sources/`.

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user connects in
that category. The binding is recorded once, at repo init, in `.brigade/config.md`
(`transport` plus the op→tool mapping the source adapter defines) — skills and workflow
scripts read the mapping from config, never hardcode a server or tool name.

## Connectors for this plugin

| Category | Placeholder | Included servers | Other options |
| --- | --- | --- | --- |
| Ticket board | `~~tickets` | — (none bundled) | Notion MCP, ClickUp MCP, `curl` + token env, Obsidian vault (fs), local markdown folder (fs) |
| Knowledge base | `~~kb` | — (none bundled) | any CLI declared in `~/.brigade/config.json` (`kb.cli` + arg templates) |

## ~~tickets — the board source

Resolved at init (see `skills/brigade/SETUP.md`): the adapter for the chosen source type
defines four operations (list-my-tickets, read, comment, set-status; contract in
`skills/brigade/sources/TEMPLATE.md`), and the transport decides what executes them:

- **`mcp`** — the session has a matching MCP server (e.g. Notion). The op→tool mapping
  is recorded in `.brigade/config.md` per the adapter; tool names are never assumed
  across deployments.
- **`curl`** — the adapter's REST path with its token env var (named in the adapter;
  never stored in any brigade file).
- **`fs`** — Obsidian vault boards and local markdown folders. No service, no token;
  the board directory is the connection.

A transport failure is a readiness failure: fix credentials or connectivity with the
user before dispatching — never guess board state.

## ~~kb — the operator's knowledge base (optional)

When `~/.brigade/config.json` (or the repo overlay) has `kb.enabled: true` and a
`kb.cli` on PATH, retros and research read/offer heuristics through that CLI using the
configured `search_args` / `ingest_args`. No vendor CLI is ever hard-required, KB writes
are always the operator's explicit call, and everything soft-fails silently when the KB
is absent.

## Access

Brigade has no inbound channel — nothing outside the session can inject messages or
drive the fleet. Cross-runtime coordination with Codex Brigade happens only through
files in the repo's `.brigade/` directory (leases and artifacts; see
`skills/brigade/SKILL.md` § Claude/Codex coordination). If a board-webhook channel ever
ships, it gets an `ACCESS.md` documenting sender policy before it lands.
