# Quickstart

Ten minutes from nothing to a merged PR, using a folder of markdown files as the board.
No service, no token, no config file to write by hand.

## 1. Install the plugin

```bash
claude plugin marketplace add /path/to/brigade
claude plugin install brigade@brigade
```

Or try it without installing: `claude --plugin-dir /path/to/brigade`.

Requirements: `git`, `node` (for `brigade-config`, `brigade-validate`, `brigade-bundle`),
`python3` (for the git-hygiene guard). `jq` and `gh` are optional — `jq` unlocks
`brigade-status --json`, `gh` lets brigade open the PR for you.

## 2. Make a board

In the repo you want to work on:

```bash
mkdir -p tasks
cat > tasks/rate-limit-login.md <<'EOF'
---
id: rate-limit-login
title: Rate limit the login endpoint
status: todo
assignee: alex
kind: feature
---

## Goal

Repeated failed logins from one IP should be throttled instead of hitting the
password check every time.

## Acceptance criteria

- After 5 failed attempts from an IP within 5 minutes, further attempts return 429.
- Successful login resets the counter for that IP.
- The limit is configurable and covered by a test.
EOF
```

Set `assignee` to whatever you want to call yourself — it just has to match the `user`
value in the config brigade writes next.

## 3. Set up brigade in the repo

Start Claude Code in the repo and say:

```
set up brigade
```

The init flow asks which source (pick **local**), where the board is (`tasks/`), your
assignee name, and the commands that verify a change in this repo — the test and typecheck
you would run before opening a PR. It writes `.brigade/config.md` and excludes `.brigade/`
from git.

Check it landed:

```bash
brigade-status
brigade-config layers
```

## 4. Cook a ticket

```
work my board
```

Brigade lists your `todo` tickets, you pick one, and then:

1. **Scouts** research the codebase in parallel and write short briefs.
2. The **Planner** breaks the ticket into small, disjoint work items and shows you the
   plan. **This is your one approval point** — check the split before saying go.
3. **Cooks** implement each item in its own git worktree, running your verification
   commands and pasting the real output.
4. An **Inspector** reviews every diff and rules PASS or FAIL. FAIL sends the item back up
   an escalation ladder — a stronger model, with the findings attached.
5. Passed items land onto one delivery branch in dependency order.
6. An **Analyst** writes a retro, and brigade opens one PR for your review.

You review the PR. Everything between the plan approval and that PR is autonomous.

## 5. Watch it without spending tokens

In any session, in the repo:

```bash
brigade-status              # tier, item statuses, worktrees, efficiency
brigade-validate            # do the artifacts conform to their schemas?
brigade-config resolve      # what settings are actually in effect
```

Slash commands wrap these: `/brigade:status`, `/brigade:validate`, `/brigade:config`.

## 6. Resume anything

Close the session mid-run and open a new one. Say `continue the dish`. State lives in
`.brigade/dishes/<slug>/PLAN.md` and the report trail, not in the conversation, so a fresh
session picks up exactly where the last one stopped. Items already landed are skipped, not
re-cooked.

## What to change first

- **Tier.** `two-star` is the default. `brigade heavy` for one dish, or set `tier` in
  `brigade.config.json` for the repo. See [tiers.md](tiers.md).
- **Parallelism.** `maxParallel` in config, if four concurrent cooks is too much for your
  machine or your test suite.
- **A rule the cooks keep getting wrong.** Add it once as a prompt override rather than
  repeating it every dish. See [overrides.md](overrides.md).

## Next

- [usage.md](usage.md) — every command and phrase, and what each actually does
- [configuration.md](configuration.md) — the four config layers
- [sources.md](sources.md) — Notion, ClickUp, Obsidian, or your own board
- [troubleshooting.md](troubleshooting.md) — when a run stalls
