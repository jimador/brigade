# 0010: The steward commits a cook's staged files when its commit was refused

## Context

A cook whose `git commit` is refused by policy can now finish its work, leave the packet's files
staged, and say `committed: false` in its report (decision 0009). Nothing acted on that yet. The
item branch had no commits, so the inspector reviewed an uncommitted tree and the landing steward
refused the branch, keeping the work but landing nothing. Finished work went round again for no
reason.

## Decision

After every cook that returns `done`, the execute workflow sends a steward, labelled
`commit:<slug>:<rung>`, before the inspector. The cook's structured return has no `committed`
field and the workflow cannot read files, so the steward reads the report itself. When the report
does not say `committed: false`, it does nothing and returns `ok: true` with
`nothing to commit`. When it does, the steward lists the staged paths with
`git diff --cached --name-only`, checks every one is in the packet's file list, and commits them by
name after `--`, with the cook's commit message or `Implement <slug>`. It confirms with
`git log --oneline -1` and returns `{ ok, detail }`.

`ok: true` goes on to inspection as normal, so the inspector reviews a real commit. `ok: false`
(an extra staged path, or the commit refused again) ends the item `blocked` with
`commit refused twice; staged work kept in <worktree>`, so the planner can commit it by hand. If
the steward returns nothing at all, inspection goes ahead: landing still refuses a branch with no
commits and leaves its worktree alone.

The setup and landing stewards still never run `git add` or `git commit`, except the staged-work
commit step; that prompt is the only place a steward commits.

## Use cases

- A cook commits its own work: the commit steward reads the report, finds no `committed: false`,
  and returns `nothing to commit`. Inspection and landing run as before.
- A cook's commit is refused and it reports done with `committed: false`: the steward commits the
  staged packet files, the inspector reviews that commit, and the item lands.
- The staged set holds a file outside the packet, or the steward's commit is refused too: the
  item blocks with the worktree untouched, and the reason says where the work is.

## Alternatives rejected

- Add a `committed` field to the cook's structured return and dispatch only when it is false.
  That changes `workflows/config.js` and both cook agents, which this change keeps out of scope;
  reading the report the cook already writes needs neither.
- Commit inside the landing steward, after the verdict. The inspector would then pass a tree
  that was never committed, and the commit could differ from what it reviewed.
- Commit with `git commit -a` or `git add .`. That sweeps in anything else in the worktree, and
  the guard refuses it anyway; naming each staged path is the only form both safe and allowed.

## Consequences

- Every done cook costs one extra steward call, usually a single `head` and an early return.
- A refused commit no longer burns a rung: the work is committed and inspected on the same one.
- A second refusal stops the item instead of retrying, since a third attempt would hit the same
  policy.
- `git commit -- <paths>` commits those paths as they stand in the worktree, so an unstaged edit
  on top of a staged file goes into the commit too; the inspector reviews the commit as made.
