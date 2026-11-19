---
title: Installation
description: Install Brigade from the plugin marketplace, set it up in a repo, keep it updated, and bring open work up to a new version's rules.
---

This page covers what Brigade needs, how to install and set it up, and what to do after an update so tickets and dishes already in flight follow the new rules.

## Requirements

- **Claude Code** with plugin support. The live board pane (`/brigade-board`) also needs a build with mods (function hooks); everything else works without it.
- **git**, for worktrees, branches and landing.
- **Node**, for the helper scripts. They use only the Node standard library, so there is nothing to `npm install`.
- **python3**, for the git-hygiene guard hook.

Optional:

- **jq** unlocks `brigade-status --json`.
- **gh** lets Brigade open the pull request for you at handoff.

No MCP server is required. A Notion or ClickUp board is read through the session's MCP server when it has one, and through the REST API otherwise. The local and Obsidian boards are plain files.

## Install the plugin

```bash
claude plugin marketplace add jimador/brigade
claude plugin install brigade@brigade
```

Working from a local clone, pass the clone's path to `marketplace add` instead. To try Brigade for one session without installing it:

```bash
claude --plugin-dir /path/to/brigade
```

For environments without plugin support there is a legacy copy install, `./install.sh --legacy`, and `./install.sh --uninstall` removes it.

## Set up a repo

In each repo you want Brigade to work, start Claude Code and run:

```text
/brigade:onboard
```

Saying `set up brigade` does the same. Onboarding scans the repo, shows a plan of what it will create, asks one approval, then asks only for values it could not detect: the board source, your identity on it, and the verification gate commands. It writes `.brigade/config.md`, adds `.brigade/` to `.git/info/exclude`, records the installed plugin version in `.brigade/onboard.json`, and offers to add a short `## Brigade` section to `AGENTS.md`.

Onboarding is safe to run again. On a repo that is already wired it changes nothing; on a repo with a missing or broken piece it repairs only that piece, and it never replaces a `.brigade/config.md` you edited by hand. It creates no commits and no branches.

The [Quickstart](quickstart.md) walks through a first setup with a local board, and [Sources](sources.md) covers Notion, ClickUp and Obsidian.

## Update the plugin

```bash
claude plugin update brigade@brigade
```

Then restart Claude Code. A running session keeps the copy it loaded, so an update does nothing until the next session starts.

On the first session after an update, the SessionStart hook compares the installed version with the one recorded in the repo. It fixes the mechanical pieces itself (the git exclusion and the version record) and tells you when something needs you:

- `Setup incomplete`: run `/brigade:onboard` to finish the board config.
- `Open work predates brigade ...`: run `/brigade:upgrade`, described next.

## Upgrade open work across versions

An update changes the rules, not the files already on disk. A ticket groomed or a plan written under an older version may be missing something the new version expects. `/brigade:upgrade`, or saying `upgrade my open work`, brings open work up to the installed version's rules.

Open work means board tickets that are not `done`, and dishes under `.brigade/dishes/` that still have an unfinished item or no acceptance verdict yet. Finished work is never touched.

### The upgrade ledger

Each plugin version that changes what open work should contain gets an entry in the ledger, [`skills/onboard/UPGRADES.md`](../skills/onboard/UPGRADES.md), newest first. An entry has:

- **touches:** what it changes. `none` means the version changed procedure only, so open work picks it up at its next phase and nothing is edited. Otherwise it names `tickets`, `dishes`, or both.
- **find:** a content check that spots the artifacts needing the change, for example a plan missing a section. It looks at what the file says, never at a version number, so running the pass twice changes nothing the second time.
- **change:** the edit to make on each match.

### What the pass does

1. **Reads the gap.** It takes the version your open work was last upgraded to (from `.brigade/upgrade.json`) and lists every ledger entry above it that touches work. A repo that was never upgraded, or is several versions behind, walks every one of those entries, oldest first.
2. **Inventories open work.** It lists your open tickets through the board's adapter and your unfinished dishes, and validates each open plan.
3. **Plans.** Each entry's `find` runs against that inventory, and every match becomes one row: the artifact, the version, the change. Items a cook or inspector is working right now get only frontmatter edits, with the rest deferred until they settle.
4. **Confirms once.** You see the whole table and say yes once. With nothing to change, it says so and asks nothing.
5. **Applies.** Dish files are edited directly. Tickets are edited only through the board's adapter, each with one activity comment naming the version.
6. **Verifies and records.** It re-validates every touched dish, re-reads every touched ticket, and records the installed version so the reminder stops. A failed row stops the record until it is fixed.

The pass edits artifacts only. It never claims a ticket, changes a status or assignee, dispatches a cook, lands, or hands off.

## Next

- [Concepts](concepts.md): the nouns Brigade uses.
- [Configuration](configuration.md): settings layers and keys.
- [Troubleshooting](troubleshooting.md): when setup or a run goes wrong.
