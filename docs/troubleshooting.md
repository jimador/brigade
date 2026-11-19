---
title: Troubleshooting
description: Fixes for the problems people hit most often with Brigade, from config that does nothing to a run that stopped early.
---

Find your symptom below. Most entries start with a free command that shows what is really
going on before you change anything.

## Start with the free checks

These cost no model tokens and answer most questions:

```bash
brigade-status          # where each dish actually stands
brigade-config doctor   # is any config layer broken?
brigade-validate        # do the artifacts conform?
git worktree list       # what is actually checked out
```

The helpers live in the plugin's `scripts/` folder and are not on your PATH. The SessionStart
hook prints that folder at the top of every session in a Brigade repo; inside a session they
run as `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-status"` and so on. `/brigade:status`,
`/brigade:config` and `/brigade:validate` run the same checks for you.

## The session ignores Brigade entirely

Check that the plugin is installed and enabled with `claude plugin list`.

The SessionStart hook is silent in repos with no `.brigade/` folder. That is by design: run
`/brigade:onboard` to set the repo up.

## A plugin change does nothing

Plugin installs are cached copies. After the plugin changes, whether from a release or your
own edit to its source, run:

```bash
claude plugin update brigade@brigade
```

Then start a new Claude Code session. A session that was already running keeps the copy it
loaded at startup. If you edited the plugin source yourself, bump `version` in
`.claude-plugin/plugin.json` first, or the update has nothing new to install.

When SessionStart then reports open work that predates the new version, run
`/brigade:upgrade` to bring open tickets and dishes up to the new rules.

## A warning says subagentStatusLine is deprecated

Claude Code prints this because the plugin's `settings.json` uses the `subagentStatusLine`
key to draw Brigade's rows in the agent panel (`scripts/brigade-subagent-line`). It is
harmless: the fleet does not depend on it. If a future Claude Code release stops running it,
Brigade's agent rows fall back to the default rendering. There is nothing to change on your
side.

## A config change had no effect

```bash
brigade-config get <the.key>
```

It prints the value and the layer that set it. A later layer is probably overriding you:
local beats team, team beats global, global beats the `## Repo` section of
`.brigade/config.md`, and that beats the defaults. `brigade-config layers` shows which files
exist at all; a typo in a filename means the layer is simply absent, not broken.

If the file exists but does nothing, run `brigade-config doctor`. Unparseable JSON and
unknown top-level keys are both reported with the file path.

`roadmap_dir` is not a JSON key. It lives in the `## Repo` section of `.brigade/config.md`,
and `/brigade:roadmap` reads it once at session start. See [Configuration](configuration.md).

## A prompt override is not applied

```bash
brigade-config prompts        # is it in the stack at all?
brigade-config prompt cook    # what text actually resolves
```

Common causes: the filename does not match a role (`scout`, `cook`, `cookHeavy`,
`inspector`, `analyst`, `design`, `designer`, `steward`, `planner`), the file is missing its
`.md` extension, or it sits under the wrong layer folder.

Overrides are resolved once, at dish start. Editing an override file mid-run does not change
agents already in flight. See [Overrides](overrides.md).

## brigade-coord says there is no lease

When no `BRIGADE_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` or `CODEX_PROJECT_DIR` is set,
`brigade-coord` finds the repo by walking up from the current folder to the first one that
holds `.brigade/`, then falls back to the git top level. Run it from anywhere else, such as a
worktree outside the repo (a custom `worktreeRoot`) or an unrelated folder, and it reads a
different `.brigade/coordination/` folder, where the dish has no lease.

Run it from the repo, or name the repo explicitly:

```bash
BRIGADE_PROJECT_DIR=/path/to/repo brigade-coord status <dish-slug>
```

`CLAUDE_PROJECT_DIR` works the same way and is already set inside a Claude Code session.

## Another dish holds a lease or a path

A dish lease makes each dish single-writer, and path leases stop two dishes from editing the
same hot file at once. When another runtime or dish holds one, stay read-only and check
whether its owner is still alive: live sessions, `brigade-status`, `git worktree list` and
artifact timestamps. A lease never expires on its own. Only after you have checked, break it
with `brigade-coord break <dish-slug> --force`, which archives the old lease rather than
deleting it.

If a crashed helper left an operation mutex behind, `brigade-coord status` reports
`operation_busy`. Recover it with `brigade-coord recover-lock <dish-slug> --force`, or
`brigade-coord recover-lock .path-leases --force` for the path-lease mutex. The full rules are
in [`skills/brigade/COORDINATION.md`](../skills/brigade/COORDINATION.md).

## A scout brief, verdict or report is missing

Sometimes an agent's own file write is refused. Every dispatched agent is told to put the full
artifact text at the end of its final message when that happens, and the workflows write it
out themselves: research writes the scout's brief, execute writes the inspector's verdict,
and review writes the review report. A transcribed file ends with one line saying the workflow
wrote it from the agent's return.

If the file is still missing, check the workflow's log for a transcription failure. For an
artifact you dispatched by hand, such as a plan check or acceptance pass, the Planner writes
the returned text verbatim, adds that same closing line, and runs `brigade-validate` on it.
A transcription copies; it never fixes the text.

A cook that stops without writing its report is caught by the SubagentStop hook, which tells
it to write the file before it finishes.

## An item is blocked

`blockedReason` names the cause. Brigade never guesses a missing value, so most blocks are a
question waiting for you: the exact value needed, the options and a recommendation. Answer it
and re-run execute.

Other causes:

- **steward-create failed**: usually a worktree or branch left over from an earlier run.
  Run `git worktree list`, then remove the stale one.
- **escalation ladder exhausted**: every rung ran and none passed inspection. The Planner
  fixes this one itself, announced, with a minimal diff that a fresh inspector reviews before
  landing.
- **circuit breaker already tripped**: the item never got a cook. Handle it through the
  stopped-early path below, not item by item.

## The run stopped early

The circuit breaker tripped: repeated inspector FAILs across items, or items exhausting their
ladders. Treat it as evidence that the plan's premises were wrong, not as bad luck.

Do not re-dispatch. Re-derive what is being built, re-scout the premises the packets were
written from, question the decomposition, and question the requirements too if they look
suspect. A third attempt against a wrong premise is the most expensive way to discover it.

If your test suite is genuinely flaky and that is the cause, raise
`circuitBreaker.maxTotalFails`, but fix the suite, because every cook pays that tax.

## An item says rework-needed

The ladder got a PASS but landing failed. `blockedReason` says which:

- **rebase conflict**: resolving it changes the shipped diff, so fix it in the item worktree
  and re-run the inspector on the resolved state before landing.
- **contamination**: something outside `.brigade/` is modified or untracked in the main
  checkout. The landing refused rather than mix it into the delivery branch. Clean or stash
  the main checkout and re-run.
- **branch not contained in delivery**: the branch and worktree are left in place for
  investigation. Nothing was deleted.

## Items hit merge conflicts

That is a decomposition defect, not a git problem: two items in the same wave touched the
same file. Record it in `.brigade/LEARNINGS.md` and sequence that work with a dependency edge
next time. The analyst picks it up in the retro. `brigade-coord hot-files` lists files that
several dishes changed recently, so the plan can lease them before dispatch.

## A board test fails under many parallel cooks

The wall-clock timing tests in `test/board/` measure speed, and a machine loaded with many
parallel test runs makes those numbers meaningless. They are opt-in and skipped unless
`BRIGADE_PERF=1` is set. If one fails, check whether `BRIGADE_PERF` is set in the cook's
environment, then re-run the file on its own on a quiet machine:

```bash
BRIGADE_PERF=1 node --test test/board/board-svg.test.mjs
```

A timing failure under load is not a code defect. Any other board test that fails only under
load is worth a bug report.

## brigade-bundle --check fails

The generated `workflows/brigade-*.js` drifted from `workflows/src/*.js` and
`workflows/config.js`. Run `scripts/brigade-bundle` and commit the regenerated output. Never
hand-edit the generated files.

## brigade-status --json errors

The `--json` output needs `jq`. Plain `brigade-status` does not.

## The guard blocked a command

The PreToolUse guard blocks broad staging (`git add -A`, `git add .`, `git commit -a`, git
pathspecs it cannot inspect, and the same commands hidden in `env`, `sh -c`, command
substitution or heredocs), and refuses to stage `.brigade/` at all.

Stage explicit paths instead: `git add src/foo.ts src/foo.test.ts`. The guard fails closed:
if it cannot parse a command, it blocks it, so an unusual but legitimate shell construction
may need splitting into simpler commands.

## Resume after a crash or a closed session

Say "continue the dish". State is on disk, so nothing is lost. Items already `done` are
skipped rather than cooked again.

Where `PLAN.md` and the filesystem disagree, the filesystem wins: check `git worktree list`
and the delivery branch, then fix the plan to match reality.
