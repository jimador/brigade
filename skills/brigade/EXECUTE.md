# Execute — Phases 3–5

Read when: before pre-flight, when a ledger returns, and when resuming mid-execute.

## Contents

- Pre-flight
- Invoke brigade-execute
- Apply the ledger
- Stop conditions
- Landing, worktrees, and working memory
- Resuming mid-execute
- Complete when

## Pre-flight

Reacquire the dish lease, then reconcile PLAN.md, artifacts, branches, and worktrees before
dispatch. Collisions are stop conditions (below); before creating the delivery worktree, run
`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" preflight <dish-slug> --branch <delivery-branch>`.
List UNCHECKED entries (offline, no `gh`) in the pre-flight report; never assume them clean.

Branches become PRs and history: name them for what they deliver, in the repo's own
convention, never for the process that made them (no "brigade" in any branch or worktree
name). Pick a short delivery slug at plan time and record it in PLAN.md frontmatter as
`delivery_branch:` — e.g. `feat/config-users`, `fix/async-401`, `docs/everyday-setup` —
matching the prefix convention the repo already uses (check `git log` and existing
branches). Cut it from the repo's main line and create the standing delivery worktree once,
before dispatch (the location `.brigade/worktrees/` stays — tidy and git-excluded):

```bash
git worktree add .brigade/worktrees/<delivery-slug> -b <delivery-branch> <main-line>
```

Set every item about to be dispatched to its dispatched-equivalent PLAN.md status. On the
first dispatch of the dish, move the source ticket to in-progress and post a short
human-facing comment (plain language, no jargon, no local paths). Then build the execute
args from `.brigade/config.md`'s gate commands and the plan's item list.

## Invoke brigade-execute

Invoking `brigade-execute` is the Planner's opt-in to multi-agent orchestration for the
cook/inspect/land loop. Invoke the Workflow tool by name, `name: "brigade:brigade-execute"`,
the same as research — never by `scriptPath`, which the tool rejects for plugin-cache
files — with args (may arrive as a JSON string): `{ dishDir, repoRoot, now, tier, deliverySlug, deliveryBranch, gate: [],
maxParallel, overrides, promptOverrides, items: [{slug, status, dependsOn: [], heavy,
packet}] }`. `packet` is the item's full, standalone work-packet text; `gate` is the repo's
verification gate commands (resolved `gate` wins over `.brigade/config.md`); `overrides` is
the `config` object from `brigade-config resolve --json` (passing the whole resolve output
also works — the scripts unwrap `.config`); `promptOverrides` comes from
`brigade-config prompts --json`, as in Phase 1. When building `items` from PLAN.md, map
frontmatter `depends_on` → `dependsOn` (the script also accepts `depends_on` as an alias).

The script runs the whole DAG: per-item worktree creation, the tier's escalation ladder
(haiku retry → heavy cook, in order), adversarial review, linear rebase + fast-forward
landing, cleanup, and a circuit breaker on repeated failure. It returns one ledger:
`{ items: [{slug, status: 'done'|'rework-needed'|'blocked'|'blocked-on-dep'|'skipped',
attempts, landedRange, reportPath, verdictPath, findings, blockedReason}], stoppedEarly,
reason }`.

## Apply the ledger

The ledger is a subagent's claim about artifact state, not the state itself: any artifact
assertion you write into PLAN.md or a landing note — verdict existence, who wrote a file,
reconstruction counts, gate reruns — derives from an artifact scan (`brigade-validate`,
`brigade-status`, or the file's own frontmatter), never from a workflow return value
alone. Telemetry is provisional until disk-verified; where they disagree, the artifact wins
and the discrepancy is itself a finding.

For each item: mirror `status` and `attempts` (each `{agentType, result}`) into PLAN.md,
record `landedRange` beside it when present, and transition a board-ticket item live per
SKILL.md's Status mapping (in-progress → done, or → blocked), never batched. Then run the
retro-readiness check: every `done` item has a populated `attempts:` entry in PLAN.md and
both a surviving `reports/<item>-cook.md` and `reports/<item>-verdict.md` on disk —
subagents have returned verdicts to the ledger without writing the file, leaving resume and
retro blind on exactly the items most worth auditing. Reconstruct any missing artifact from
the ledger's structured data (attributed as such) before the dish counts as retro-ready, and
report it as healed, never folded into a clean pass. A reconstructed verdict that gated a
heavy or otherwise high-risk item gets a real re-inspection: rebuilding it from telemetry
drops the gate-rerun evidence that made it worth anything. Then act on status:

- `done` — landed and cleaned up; nothing further.
- `skipped` — was already `status: done` in PLAN.md when the script started (resume).
- `blocked-on-dep` — a dependency did not land this run; re-invoke execute once it does.
- `rework-needed` — PASS, but landing failed; `blockedReason` names which: a rebase
  conflict, contamination in the main checkout, or a branch not contained in the delivery
  branch. Resolving a conflict changes the shipped diff: fix it in the item worktree,
  re-inspect the resolved state, then land it yourself by the same recipe (contamination
  check, rebase, fast-forward, cleanup) — the one path the script cannot retry unattended.
- `blocked` — `blockedReason` names the cause. A steward-create failure or a cook-reported
  readiness/underspecified-value block needs a decision-ready question: name the exact value
  needed, never guess one to keep moving — a cook that blocked on an impossible packet step
  instead of inventing a workaround did its job, so rule on the question and fix the packet
  rather than re-dispatch the contradiction. A ladder exhausted with no PASS is your rung 3:
  fix it yourself (announced, minimal diff), re-inspect, then land it the same way. An item
  the tripped breaker never dispatched is handled under `stoppedEarly`.

`stoppedEarly` means the circuit breaker tripped (repeated FAILs across items, or an item's
ladder exhausted) — evidence of invalid starting assumptions, not bad luck. Do not
re-dispatch: re-plan from first principles (re-derive what is being built, re-scout the
packet's premises, question the decomposition) and bring the operator in only if the
requirements themselves look suspect; a third rework attempt on a wrong premise is the most
expensive way to discover it.

## Stop conditions

These are the only reasons to interrupt a dish between plan approval and handoff; nothing
else is a reason to stop and ask.

- A pre-flight collision — report what is in flight (the branch, the PR URL, or the other
  dish's overlapping items) and stop; never rename around it or defer it as a merge problem.
- A `blocked` item that needs a decision — name the exact value; never guess one.
- `rework-needed` (rebase conflict) — fix in the item worktree, re-inspect, land yourself.
- The ladder exhausted with no PASS — rung 3: fix it yourself, announced, minimal diff,
  re-inspected, landed the same way.
- `stoppedEarly` — re-plan from first principles; bring the operator in only if the
  requirements themselves look suspect.

## Landing, worktrees, and working memory

Worktrees are script-owned, not native. The steward stage creates each item's worktree
(`git worktree add .brigade/worktrees/<delivery-slug>--<item-slug> -b
wip/<delivery-slug>/<item-slug> <delivery-branch>`) before its first cook attempt, and on
PASS lands it: a stand-down check first — `git status --porcelain` against the main checkout
— refuses to land if anything outside `.brigade/` is modified or untracked, so a stray cook
can never contaminate the main checkout; then rebase in the item worktree, `--ff-only` merge
in the delivery worktree, then removes the worktree and branch. The Planner never runs these
commands directly; PLAN.md still gets the landed SHA range for traceability.

With `graphite_restack: true` in repo config, you own `gt` for landing/rework rebases — the
script always lands with plain git. After the ledger returns, restack/absorb yourself per
`GRAPHITE.md` for sequential chains that need it; never ask cooks/scouts/inspectors to run
`gt`. `graphite_platform` only changes Phase 6 handoff (`gt submit --stack`).

Working memory is script-decided, not planner-decided; on by default, `workingMemory: false`
in any config layer disables it fleet-wide. The script attaches a ledger (see `MEMORY.md`)
to heavy items and rework passes at `.brigade/dishes/<dish>/state/<item>.md`: the cook
keeps the packet's constraints as protected Canon plus its own verified World state, the
next attempt inherits it, and the Inspector audits it. Packets need no extra section:
Canon is seeded from their file list, contracts, and Verify commands, so paste those exact.

## Resuming mid-execute

Build the `items` arg from PLAN.md's current statuses as-is — items already `status: done`
are still included; the script returns those as `skipped` rather than re-cooking them. A
Workflow `resumeFromRunId` (where the runtime offers one) is a same-session accelerator
only, never the source of truth for what already landed — PLAN.md and the report trail are.

## Complete when

Every item in the ledger is `done` or `skipped` and PLAN.md mirrors it; every done item has
its cook report and verdict on disk (reconstructions reported as healed); or a stop condition
above has been reported to the operator with a decision-ready question. Then read
`HANDOFF.md` — do not stop to ask whether to continue.
