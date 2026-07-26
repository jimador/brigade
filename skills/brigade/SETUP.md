# Setup and workspaces

Read when: first run in a repo (no `.brigade/config.md`), or the session cwd matches a
workspace. Not needed on a repo that already has a working board wiring.

## Setup (first run in a repo)

0. Run `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" layers` and `... doctor` (free). They tell you which
   config layers exist and whether any is broken, before you touch anything else.
1. Check for `.brigade/config.md` in the repo root. If present, read it and continue.
2. If absent, run **init**:
   - Read `templates/config.md` (next to the SKILL) without writing it and interview the
     user for the values: source type, board/database id, their identity on the source,
     the status-name mapping, and the repo's verification gate commands.
   - Gather all discoverable and operator-provided values first. Acquire coordination key
     `repo-global` as `claude`, re-check that config is still absent, write the config and
     exclusion, then release it before any further human checkpoint.
   - Pick the source **transport**: if the session has matching MCP tools (e.g. a Notion
     MCP server), prefer them — record the transport and the op→tool mapping in config per
     the source adapter. Otherwise use the adapter's CLI/curl path with its token env var.
   - Verify source access with one cheap read (per the source adapter). If it fails, fix
     credentials with the user before doing anything else.
   - If a personal KB CLI is configured in `~/.brigade/config.json` (`kb.enabled` + `kb.cli`)
     and that CLI is on PATH, optionally confirm identity helpers it exposes; otherwise skip.
   - Never put `.brigade/` in tracked `.gitignore` and never commit it.
3. `.brigade/` layout (all local, never committed):

```
.brigade/
  config.md                  # board wiring: source, board id, identity, gate
  config.local.json          # optional personal settings layer (this repo, uncommitted)
  overrides/agents/          # optional personal prompt overrides (this repo)
  overrides/prompts/
  LEARNINGS.md               # append-only retro notes
  dishes/<dish-slug>/
    PLAN.md                  # the DAG + all work packets
    DESIGN.md                # design swag (when applicable)
    CONTEXT.md               # gathered context sources (optional)
    briefs/                  # scout briefs
    reports/                 # cook reports + inspector verdicts
    analyst.md               # self-improvement report (dish handoff)
  worktrees/<flat-branch>/   # executor worktrees (or workspace worktree_root)
```

## Workspaces (multi-repo cwd)

When the session cwd matches a workspace in `~/.brigade/workspaces.md` (or a vault
`tickets/<id>/_workspace.md`):

1. List/groom across **all** member boards under `~/vault/tickets/<workspace>/`.
2. Tickets carry `workspace`, `project`, and `repo` (absolute child git path).
3. Cook worktrees under `worktree_root`; branches live in the **child** repo — never treat
   the workspace root as the git remote.
4. Prefer `<repo>/.brigade/dishes/<slug>/` for dish artifacts.
5. See `sources/workspaces.md` and `sources/obsidian.md`.
