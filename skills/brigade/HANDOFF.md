# Handoff — Phase 6

Read when: every item has landed and the dish is ready to hand off, before a PR is opened,
edited or marked ready, or before a diff lands without an inspector pass.

## 1. Prove the gate

Run the full gate once on the integration branch (a cook, if output is long). Before handoff
text calls it green, prove the commands that ran cover every claimed kind at full scope:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-evidence" cover --claim test,lint,typecheck -- <commands actually run>
```

A non-zero exit means a claimed kind was covered only by a targeted run. Never upgrade a
targeted check into repo green — fix coverage or say, per kind, what was and was not proven.

**A red gate is bisected, not guessed.** When the full gate fails and more than one item has
landed, find the first red commit mechanically, in a scratch worktree so the delivery
worktree keeps its checkout:

```bash
git worktree add --detach <scratch> <delivery-tip>
cd <scratch>
git bisect start <delivery-tip> <integration-base>
git bisect run <the failing gate command>
git bisect reset
```

`<integration-base>` is the delivery branch's fork point, `git merge-base <main_branch>
<delivery-tip>`. Map the first bad commit to its item through `landedRange` in PLAN.md (or
the item slug the landing commit names), send that item to
rework with the bisect log as its finding, and remove the scratch worktree. Never blame the
last item to touch the failing file: a later item that only reshapes the code there is the
usual wrong answer, and bisect costs log₂(N) gate runs.

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

## 3. Red-team the delivery range

The Inspector judged each item alone. The red team reviews the whole delivery range at its
current head, after the acceptance pass and before any PR text. It adds to the per-item gate
and never replaces it. Its settings are `review.redTeam` (`CONFIG.md` § Red team and PR
template).

1. Record the head and range, pick the tools, and write the brief both passes read:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/brigade-pr" redteam --base <main_branch> --author claude \
     --brief .brigade/dishes/<slug>/reports/red-team-brief.md --json
   ```

   `--author` is the runtime that wrote the code: `claude` here, `codex` in a Codex session.
   The find pass runs in a tool other than the author's and the verify pass in a tool other
   than the find pass's. A tool that is not installed is skipped and the next one in
   `reviewerOrder` takes its place. Exit 1 means no tool is installed: stop, open the PR as
   a draft, and say which pass could not run.
2. Run the find command from the delivery worktree, in the background, into
   `reports/red-team-find-<head7>.txt`. Run `redteam` again with `--findings` set to that
   file and run the verify command it returns into `reports/red-team-verify-<head7>.txt`.
   Each pass is its own process with its own context. Never stand in for a pass with your
   own reading of the diff, and never let a cook that wrote the code run one.
3. Fix what survives. Each `error`, and each `warning` not recorded as a decision in the PR,
   becomes a rework item through `brigade-execute`: its first step is a test that fails on
   the reviewed head, then the fix makes it pass, then the Inspector gates it. A defect no
   test can show names the command or trace that proves the fix. Re-prove the gate (§ 1).
4. A new head makes the review stale. Review the range again at the new head and record it.
   After two rounds that still leave an `error`, stop and ask the operator one
   decision-ready question; the PR stays a draft.
5. Record every round in `reports/red-team-<head7>.md` (`red_team` in `SCHEMAS.md`) and run
   `brigade-validate` on it. `verdict: clean` only when no `error` and no undecided
   `warning` survives on that head.

Only a human waives the review, in their own words, with a reason. Record it as
`verdict: override` with their `Override: <name>, <reason>` line. An agent never writes an
override. With `review.redTeam.required: false` the red team is advisory: it still runs,
and the PR may record n/a with a reason.

## 4. Hand off the branch

Write the PR body from the configured template and check it before anyone sees it:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-pr" template > .brigade/dishes/<slug>/pr-body.md
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-pr" check .brigade/dishes/<slug>/pr-body.md --base <main_branch>
```

Fill every section from evidence on disk. How it was validated carries each gate command
from § 1 as `$ <command>` with its real output from the head, and a `Scope:` line that
matches the `brigade-evidence cover` result: `full`, or `targeted` and what it leaves out.
Red-team review copies Head, Range, both passes, the findings and the verdict from the
latest `red-team-<head7>.md`. `check` must print `check: ok` before the body is published.

If the base branch has advanced (or its own PR merged) since you branched, rebase the
integration branch `--onto <latest main> <original base>` for a clean per-ticket diff. Do it
before § 3 when you can: a rebase makes a new head, and a new head needs its own review.

Open the single human-review PR `<delivery-branch> → main` as a draft
(`gh pr create --draft --body-file <file>`). Mark it ready only after
`brigade-pr check --pr <n> --ready` prints `check: ok`, which needs a clean verdict or a
human override on the current head; then `gh pr ready <n>`. Run `check --pr <n>` again
after every edit to the body. A push after the review sends you back to § 3. With no remote
or `gh`, tell the user the integration branch is ready for local review and attach the
red-team record.

With `graphite_platform: true` in the repo config this step becomes `gt sync` +
`gt submit --stack`, one PR per item; see `GRAPHITE.md`. Each PR in the stack carries the
red-team review of its own layer's range and passes `check --pr`. With `remote_pr: false`
in `.brigade/config.md`, or an operator directive to land without a PR: rebase onto the
latest main, prove the gate and run the red team on the tip, fast-forward push (never
`--force`), and say so in the handoff with the red-team verdict; the ticket then moves on
the human's review of the pushed branch. When the session start listed writing rules, the
PR body follows the preset's rule text and every `pr_body` rule.

## 5. Ticket and comment

Move the ticket to its in-review-equivalent status; post a handoff comment — what changed,
how it was verified, how to review — plain language, nothing a board reader can't open.
When the session start listed writing rules, the comment follows the preset's rule text and
every `ticket_comment` rule.

## 6. Retro

Retros run on the tier's cadence (`TIERS.md`) and are never skipped silently at any tier:
if you must defer a due pass, say so to the operator. Read `RETRO.md` before dispatching
`brigade-analyst`, applying its report, offering heuristics to the KB, or running a
brain-upgrade pass — the protocol lives there. Three invariants hold regardless: KB writes
are the operator's call (one yes/no per retro, never automatic); a brain upgrade edits the
plugin source, never the installed copy; and a brain upgrade that adds a rule also compacts
the section it touched — absorbing without compacting makes prose nobody can scan.

## 7. Done

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
delivery head has a clean red-team record or a human override, the PR is open and
`brigade-pr check --pr <n> --ready` passes on its published body (or the branch is pushed or
handed off as the repo config directs), the ticket is in review with a plain-language
comment, a due retro has run or its deferral is stated to the operator, and the dish lease
is released. Report the handoff in two lines: what shipped, where the evidence lives.
