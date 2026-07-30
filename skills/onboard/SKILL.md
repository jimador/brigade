---
name: onboard
description: Set up brigade in a repo, or repair/upgrade an existing setup. Use when the operator wants to onboard this repo, get brigade working here, finish board wiring, fix a broken .brigade/config.md, or upgrade after a plugin update leaves drift. Triggers on "onboard this repo", "set up brigade", "repair brigade setup", "finish board wiring", "brigade doctor said drift".
---

# Onboard

One-time setup and any-time repair for a repo's brigade wiring. Scan what's already true,
plan the gap, ask the operator only what can't be inferred, execute, verify. Safe to re-run:
a second pass repairs whatever is still wrong and touches nothing that's already correct.

## Scan

Run both, read-only:

- `${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard status --json`
- `${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard detect --json`

Classify each piece against the combined output:

- **config.md** — `board-config` step `state: ok` → skip. `pending` and the file doesn't
  exist → create. `pending` and it exists but is short a key or a step later reports drift
  against it → repair.
- **git exclusion** — `git-exclude` step: `ok` → skip, `pending` → create (via `apply`), `na`
  → skip (no `.git`, nothing to exclude).
- **onboard.json** — `version-record` step: `ok` → skip, `pending` → create/repair (via
  `apply`).
- **agent-instructions section** — `detect.agents_file` set and that file already has a
  `## Brigade` heading → skip. `agents_file` set without the heading → repair (append).
  `agents_file: null` → create (new `AGENTS.md`).

## Plan

Present one table before touching anything:

| Piece | Action | Detail |
|---|---|---|
| config.md | create / repair / skip | |
| git exclusion | create / skip | |
| onboard.json | create / skip | |
| agent-instructions section | create / repair / skip | |

One **AskUserQuestion** approval gate for the whole plan. Declining stops here — no writes,
no interview.

## Interview

**AskUserQuestion**, at most 4 questions per round, asking only about values Scan could not
detect:

1. Source type (notion/clickup/local/obsidian) and board id or `board_dir` — skip if
   `config.md` already has a non-placeholder value.
2. Operator identity on the source (`user_id` / `user`) — skip if already set.
3. Status-mapping deviations from the template default (identity mapping) — offer the
   default, ask only if the operator wants to change it.
4. Gate confirmation: seed the question from `detect.gate_candidates`, let the operator pick
   one, edit it, or reject all of them. When the detector found nothing (or the operator says
   its picks are wrong), point them at `.github/workflows/` — CI-derived commands the
   detector doesn't parse.

Run more rounds only if a prior answer opens new undetected values (e.g. picking `notion`
surfaces the MCP tool map). Never re-ask a value the operator already gave or that Scan
already found.

## Execute

Create `.brigade/` if it doesn't exist yet — this **is** the layout scaffold; `dishes/`,
`worktrees/`, and `overrides/` are created lazily by the fleet the first time it needs them,
never here.

**config.md** — hard rule: an existing `.brigade/config.md` is **repaired, never replaced**.
Repair means: fill placeholder or missing keys only, from Scan + Interview answers. Any key
the operator has already hand-edited to a real value is left untouched, and the report names
which keys those were. Only when the file does not exist yet: copy
`skills/brigade/templates/config.md` and fill every value — source, transport,
`database_id`/`board_dir`, user identity, status mapping, `main_branch`, `tier`,
`verification_gate`, `test_convention`, `remote_pr`.

Run `${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard apply` — converges the pending automatic
steps (`.git/info/exclude` gets a `.brigade/` line; `.brigade/onboard.json` records the
installed plugin version).

**Agent-instructions injection**, with operator consent from Plan: target is `detect`'s
`agents_file` (create `AGENTS.md` when it's `null`). Hard rule — guard with
`grep -q '^## Brigade' <file>` and skip when it matches; never inject a second section.
Otherwise append a `## Brigade` section, at most 10 lines: which source the board runs on,
where the config lives (`.brigade/config.md`), the line "never commit `.brigade/` — kept in
`.git/info/exclude`", and a pointer at the configured verification gate.

Hard rule — this skill creates no git state: no commits, no branches, and it never touches
tracked `.gitignore` (the exclusion lives only in `.git/info/exclude`, written by `apply`).

## Verify

- `${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config doctor` — every config layer resolves clean.
- One cheap board read, per the configured source's adapter (`skills/brigade/sources/
  <source>.md`) — its "list my tickets" op, run once, proves the credentials and
  transport actually work.
- Read `.brigade/config.md` back and confirm the values just written are the ones present on
  disk.
- Report a table: piece, status icon (done / repaired / skipped / failed), one-line detail.
  On any failure, state exactly what's still wrong — don't silently mark it done.

## Upgrades

A plugin version bump can leave drift — `brigade-onboard status --json` reporting
`drift: true`. The **automatic** steps (git exclusion, onboard.json) self-heal at
SessionStart; this skill is the handler for the one step that can't run unattended
(`board-config`, since it needs operator answers). Re-run this skill any time — on a repo
that's already fully wired it's a no-op scan followed by a Plan with every piece marked
skip; on a repo with drift it repairs exactly the pieces that need it.
