---
title: Quickstart
description: Go from nothing to a landed, reviewed change in about ten minutes, using a folder of markdown files as your board.
---

This page takes you from a fresh install to one ticket cooked, inspected and landed on a delivery branch. You use the local board, a folder of markdown files, so there is no service to connect and no token to set.

## Install the plugin

```bash
claude plugin marketplace add jimador/brigade
claude plugin install brigade@brigade
```

Requirements and other ways to install are on [Installation](installation.md).

## Make a board

In the repo you want to work on, create a `tasks/` folder with one ticket in it:

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
- A successful login resets the counter for that IP.
- The limit is configurable and covered by a test.
EOF
```

Set `assignee` to whatever you want to call yourself. It only has to match the `user` value you give Brigade in the next step, because the local board lists tickets whose `assignee` is you and whose `status` is `todo`.

## Set up Brigade in the repo

Start Claude Code in the repo and run:

```text
/brigade:onboard
```

Saying `set up brigade` does the same thing. Onboarding scans the repo, shows you a short plan of what it will create, and asks one approval for the whole plan. Then it asks only what it could not detect:

- **Source:** pick `local`, with `tasks/` as the board folder.
- **Your name on the board:** the `assignee` value you used above.
- **Verification gate:** the commands that prove a change works here, like your test and typecheck commands. It suggests candidates it found in the repo.

It writes `.brigade/config.md`, adds `.brigade/` to `.git/info/exclude` so nothing under it is ever committed, records the plugin version, and offers to add a short `## Brigade` section to your `AGENTS.md`. It finishes by validating the config and reading the board once, so a broken setup shows up now rather than mid-dish.

Check the result at zero token cost:

```text
/brigade:config
/brigade:status
```

## Cook your first ticket

Say:

```text
work my board
```

Brigade lists your `todo` tickets. Pick one, and the dish begins:

1. **Intake.** The planner claims the ticket: it moves it to `in_progress` and checks your other open tickets for overlap.
2. **Research.** Scouts answer a few focused questions about the codebase in parallel and write short briefs.
3. **Plan.** The planner splits the ticket into small work items, each one or a few named files with its own verification command, and shows you the plan. **This is your approval point.** Check the split, then say go.
4. **Cook.** Cooks implement the items in parallel, each in its own git worktree, and paste the real output of your gate commands as evidence.
5. **Inspect.** An inspector reviews every diff and rules PASS or FAIL. A FAIL sends the item back up an escalation ladder with the findings attached, ending at a stronger cook.
6. **Land.** Passed items land on one delivery branch in dependency order, by rebase and fast-forward.
7. **Hand off.** The planner proves the gate at full scope, runs an acceptance pass against the ticket's criteria, opens one PR (or hands you the branch), moves the ticket to review, and runs the retro when the tier calls for one.

Between your plan approval and the handoff, the fleet runs on its own. It stops early only for a decision it cannot make: then it asks you one question with options and a recommendation, or marks the ticket `blocked` with a comment.

## Watch it without spending tokens

Open another Claude Code session in the same repo at any time:

```text
/brigade:status      # tier, each dish's items by status, worktrees, leases, efficiency
/brigade:validate    # do the dish artifacts match their schemas?
/brigade:config      # which settings are in effect, and which layer set them
```

The dish's files live in `.brigade/dishes/<slug>/`: the plan in `PLAN.md`, briefs, cook reports and inspector verdicts under it.

## Resume anything

Close the session mid-run and open a new one, then say `continue the dish`. State lives in `PLAN.md` and the report trail on disk, not in the conversation, so a fresh session picks up where the last one stopped. Items that already landed are skipped, never cooked twice.

## What to change first

- **Tier.** Two-star is the default. Say `brigade heavy` for one dish on a stronger model, or run `/brigade:tier three-star` to change the repo. See [Tiers](tiers.md).
- **Parallelism.** Set `maxParallel` in config if four cooks at once is too much for your machine or your test suite. See [Configuration](configuration.md).
- **A rule the cooks keep missing.** Add it once as a prompt override instead of repeating it every dish. See [Overrides](overrides.md).

## Next

- [Concepts](concepts.md): the nouns you just saw, defined.
- [Run a dish](usage.md): every phrase, command and helper.
- [Sources](sources.md): move from the local board to Notion, ClickUp or Obsidian.
- [Troubleshooting](troubleshooting.md): when a run stalls.
