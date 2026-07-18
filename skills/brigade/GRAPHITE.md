# Graphite mode (optional, off by default)

Brigade can drive its stack rebases and its handoff through the Graphite CLI (`gt`).
Two independent switches in `.brigade/config.md` under `## Repo`; a missing key means
`false`, and everything in SKILL.md works unchanged when both are off.

- `graphite_restack: true` — the Planner uses `gt` for the local rebase mechanics at
  landing and rework. No account, no network: create/track/restack/absorb/undo are
  plain git underneath.
- `graphite_platform: true` — handoff ships the dish as stacked PRs through the
  Graphite platform (`gt submit --stack`, merge queue, Graphite's AI review) instead of
  the single delivery→main PR. Implies `graphite_restack`. Requires the repo owner to
  have authed the CLI (`gt auth`) and installed the Graphite GitHub app.

## Preflight (once per dish, before the first gt operation)

1. `gt --version` ≥ 1.8.4 (worktree-safe line; older gt can clobber branches checked
   out in other worktrees).
2. Repo is initialized: `gt` knows the trunk and it matches `main_branch`. If not,
   `gt init` once, choosing `main_branch` as trunk.
3. Platform mode only: `gt auth` reports an authed user, and the repo has the Graphite
   GitHub app (a previous `gt submit` in this repo, or the repo's docs, is evidence).

Any preflight failure → run the dish on the plain-git flow and record why in PLAN.md.
Graphite is a convenience; a dish never blocks on it.

## Hard rules

- **Only the Planner runs `gt`.** Cooks, Scouts, and Inspectors use plain git. gt keeps
  stack metadata in shared refs — concurrent gt operations from parallel worktrees race.
- **A branch belongs to its worktree.** Run each gt operation from the worktree that has
  the branch checked out (gt ≥ 1.8.4 enforces most of this by refusing to touch branches
  checked out elsewhere).
- **Never `gt sync` while any cook is in flight** or while the main checkout is dirty —
  it prunes and restacks broadly. Sync only between waves, from the delivery worktree,
  after the stand-down check.
- Restacks rewrite SHAs exactly like the manual rebase chain does. The existing rule
  holds: verdicts cite pre-rebase SHAs, PLAN.md maps them to landed ranges.
- A gt operation that went wrong: `gt undo`, then record what happened in PLAN.md.

## Worktree behavior (gt ≥ 1.8.4 — graphite.com/docs/multiple-worktrees)

What gt itself guarantees and where it doesn't, so the Planner predicts instead of
discovers:

- **One checkout per branch.** A branch checked out in any worktree is off-limits to gt
  operations run elsewhere — commands exit with an informative error rather than cross
  the boundary (`gt modify --into` a branch held by another worktree halts, for example).
- **Trunk is the exception.** `gt sync` and `gt get` may move the local trunk even while
  it is checked out in another worktree — including the main checkout. After any sync
  from the delivery worktree, treat the main checkout's trunk position as stale until
  looked at.
- **`gt create --onto <branch>` is safe** when the target branch is checked out in
  another worktree — use it to cut item branches from the delivery branch without
  touching the delivery worktree.
- **`gt restack` is per-worktree.** A stack spanning several worktrees restacks worktree
  by worktree — run it from each worktree that holds part of the chain; one invocation
  does not reach across.
- **`gt undo` is per-worktree.** Its history is scoped to the worktree it ran in; it
  cannot revert an operation performed in another worktree, and it stops rather than
  touch branches checked out elsewhere.
- **`gt log` shows worktree paths** when branches live in multiple worktrees — the
  cheap way to verify who holds what before a landing or sync.

## Restack mode (`graphite_restack`)

The landing recipe and its guarantees (linear history, `--ff-only`, stand-down check)
are unchanged; gt replaces the hand-rolled rebase cascade where a cascade exists.

- Track the delivery branch once at dish start: `gt track <delivery-branch>` with trunk
  as parent (run in the delivery worktree).
- Independent items: land exactly as in SKILL.md Phase 3. Tracking them buys nothing.
- Sequential chains (item B branched from item A's landed work): track each chained
  branch with its dependency as parent. When rework lands low in the chain,
  `gt restack` from the chain's worktree replaces the per-branch rebase cascade, and
  `gt absorb` can drop a fix commit into the branch that owns the touched lines.

## Platform mode (`graphite_platform`)

Landing stays linear, but item branches become the PR stack, so two Phase-5/6 steps
change:

- **Keep item branches at landing.** After each `--ff-only` landing, `gt track` the
  item branch with the previously landed item (or the delivery base for the first item)
  as parent, and skip the `git branch -d` cleanup. Because landing is linear, each
  branch tip sits on the delivery history and the tracked chain is a valid stack.
  Worktrees are still removed at landing; only branches persist until the stack merges.
- **Handoff (replaces SKILL.md Phase 6 step 3):** from the delivery worktree, restack
  on latest trunk (`gt sync` — waves are done, checkout is clean), then
  `gt submit --stack` — one PR per item in dependency order. `--ai` may fill titles
  and descriptions on new PRs; the PR bodies still follow the handoff rules (summary,
  evidence highlights, risks, plain language — item branch names appear publicly, so
  keep them clean). The ticket's in-review comment and the analyst pass are unchanged.
- The human merges through Graphite (merge queue handles order). The ticket reaches
  done when the whole stack has merged; delete the item branches and the delivery
  branch after that.
- If submit fails (auth, app, network) → fall back to the standard single
  delivery→main PR and say so in the handoff comment to the user.

## Config example

```
- graphite_restack: true    # gt drives landing/rework rebases (local-only)
- graphite_platform: false  # single delivery→main PR at handoff
```

The agent-facets repos run with `graphite_platform: true`.
