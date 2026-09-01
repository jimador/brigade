# Handoff — Phase 6

Read when: every item has landed and the dish is ready to hand off, or before a diff lands
without an inspector pass.

## 1. Prove the gate

Run the full gate once on the integration branch (a cook, if output is long). Before handoff
text calls it green, prove the commands that ran cover every claimed kind at full scope:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-evidence" cover --claim test,lint,typecheck -- <commands actually run>
```

A non-zero exit means a claimed kind was covered only by a targeted run. Never upgrade a
targeted check into repo green — fix coverage or say, per kind, what was and was not proven.

Also run a whole-feature adversarial review of the assembled behavior when the dish built
one feature incrementally across items, contains a heavy data-correctness item, or —
regardless of tier — has one item write a config or data value another consumes: per-item
reviews are blind to properties that span sibling diffs, proven twice and twice more at the
writer/consumer boundary. Its dispatch prompt demands the section 2 evidence table.

## 2. The acceptance pass

Build the checklist (one row per acceptance criterion across all items, plus ticket-level
success criteria) and dispatch `brigade-inspector` in Mode 4 with it, the delivery worktree,
the gate commands, stage or run instructions when the deliverable runs, and the output path
`reports/acceptance-verdict.md`. Never run the pass yourself. The prompt requires:

- Exactly one verdict per criterion: VERIFIED (human-openable evidence attached),
  COVERED-BY-GATE (name the covering test or journey), or NOT VERIFIED (what was observed).
- On a per-developer stage, when the repo deploys one: deploy the integration branch and
  exercise each criterion against it. Preflight the stage's seed data and a capture tool
  that persists evidence a human can open; if either is missing, seed it (into the repo's
  seed scripts) or fall back to the integration-suite output as evidence of record, and say
  which. Auth-gated criteria that cannot be driven live are COVERED-BY-GATE, per criterion.
- When the deliverable runs — a service, a pack, a pipeline — the pass is a live fire: boot
  from the documented empty state, drive the runbook, and watch the runtime path actually
  resolve and fire, writing a conforming report into `reports/`. Compile-and-install suites
  prove nothing about the runtime path; one live fire caught three demo-blocking defects.
- Re-read every deferral the intake or plan recorded against the diff the dish actually
  landed: a deferral judged reachability under the old code. A fix that made the deferred
  bug reachable, likelier, or worse makes it undeferrable — fold it in or block on it.

Read the verdict: every NOT VERIFIED criterion is a finding to fix — a cook dispatch, then
re-run the pass — before any handoff text. Attach the evidence to the ticket.

## 3. Hand off the branch

Open the single human-review PR `<delivery-branch> → main` (`gh pr create`) with
summary, item list, Evidence highlights, and risks — or, with no remote or `gh`, tell
the user the integration branch is ready for local review. If the base branch has advanced
(or its own PR merged) since you branched, rebase the integration branch `--onto <latest
main> <original base>` first for a clean per-ticket diff. With `graphite_platform: true`
in the repo config this step becomes `gt sync` + `gt submit --stack`, one PR per item;
see `GRAPHITE.md`. With `remote_pr: false` in `.brigade/config.md`, or an operator
directive to land without a PR: rebase onto the latest main, prove the gate on the tip,
fast-forward push (never `--force`), and say so in the handoff; the ticket then moves
on the human's review of the pushed branch.

## 4. Ticket and comment

Move the ticket to its in-review-equivalent status; post a handoff comment — what changed,
how it was verified, how to review — plain language, nothing a board reader can't open.

## 5. Retro

Retros run on the tier's cadence (`TIERS.md`) and are never skipped silently at any tier:
if you must defer a due pass, say so to the operator. Read `RETRO.md` before dispatching
`brigade-analyst`, applying its report, offering heuristics to the KB, or running a
brain-upgrade pass — the protocol lives there. Three invariants hold regardless: KB writes
are the operator's call (one yes/no per retro, never automatic); a brain upgrade edits the
plugin source, never the installed copy; and a brain upgrade that adds a rule also compacts
the section it touched — absorbing without compacting makes prose nobody can scan.

## 6. Done

The ticket reaches its done-equivalent status only when the human merges the PR (or accepts
the pushed branch); delete the integration branch only after that. Release the dish lease
before returning the handoff to the operator.

## Spot-checks in place of an inspector pass

Four paths skip the gate quietly: a commit you made directly to the integration branch, a
fix produced by overriding a PASS into rework, a docs-only item you self-verified instead
of dispatching an inspector, and — the one that costs most — **cooking outside the
Workflow.** The inspector gate lives inside `brigade-execute`, so the moment you dispatch
cooks as direct subagents (because the Workflow broke, or the item was small) adversarial
review silently disappears and nothing tells you. It is not optional there: dispatch
`brigade-inspector` yourself, per item, before landing, and write its verdict to
`reports/<item>-verdict.md` exactly as the Workflow would. Planner self-review of the diff
is not a substitute — a dish that landed four items this way shipped with zero verdicts
while every item read `done`. The first three paths are legitimate; each gets a short
verdict-shaped note beside the cook report naming the commit, what you checked it
against, and what you corrected — silent fixes leave the item unscoreable. A diff-conformance spot-check replaces
a full inspector pass only when all three hold: the diff is annotation-, comment-, constant-
or doc-only; every file it touches already PASSed inspection this dish; and the item's own
Verify commands were re-run green. Record the deviation in PLAN.md.

## Complete when

The gate is proven at full scope, every acceptance criterion carries exactly one verdict, the
PR is open — or the branch is pushed or handed off as the repo config directs — the ticket is
in review with a plain-language comment, a due retro has run or its deferral is stated to the
operator, and the dish lease is released. Report the handoff in two lines: what shipped, where
the evidence lives.
