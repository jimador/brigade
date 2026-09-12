# Retro — skill authoring, 2026-09-12

The dish that restructured brigade's own prompt surfaces: `skills/brigade/SKILL.md` became a
router over five phase companions, every agent description was rewritten, `AGENTS.md` became the
single repo-level instruction file, the eval suite was created, and two features landed (the
Planner's working-memory ledger, and guarded agent calls in `brigade-execute`). 25 items, one
delivery branch, version 0.38.0.

Dish artifacts live under `.brigade/`, which is never committed and does not outlive the machine
that ran it. This record is the part worth keeping: what the run cost, what the experiment
measured, and what changed as a result. The rules it produced are in
[`skills/brigade/policies/heuristics.md`](../../skills/brigade/policies/heuristics.md); the
experiment entries are in [experiments.md](../experiments.md).

## Scorecard

| | |
| --- | --- |
| Items dispatched | 24 (plus one landed by the Planner with a spot-check) |
| First attempt clean | 17 of 24 (71%), or 79% excluding harness failures |
| Reworked | 7 — none of them for a wrong diff |
| Escalations | 4 fail-retry dispatches; 3 fixed the item next attempt |
| Merge conflicts | 0 |
| Subagent tokens | ≈2.9M wave 1, ≈2.5M wave 3 |

**Every rework this dish paid for was plumbing, not cooking.** Of the seven, two were packet
Verify defects (a count that could not be satisfied), three were report-format or report-honesty
defects, and two were harness failures. The merged diffs were right the first time in 24 of 24
items. That says the heavy first attempt and the packet bar worked, and the machinery around them
did not.

**Escalation and granularity.** At three stars every first attempt is already the heavy cook, so
the `heavy` flag is not an escalation lever — which is why it was free to carry the experiment.
Packets ran 72–284 lines against a 120-line ceiling, with two deliberate over-runs recorded. The
only cook to exhaust its 80-turn cap ran the largest packet; after a turn-budget note was added to
the dispatch, every later cook returned in 15–59 tool calls.

**Gate honesty.** One breach class: the same defect drew two thresholds in one wave. An item
FAILed for a fabricated Evidence section while two others passed the identical defect as medium.
That inconsistency is the reason one of the heuristics exists.

**Tier fit — keep three stars for prompt work.** The two plan checks returned four and six
blocking items, all folded before dispatch, including an unreachable line cap and a smoke command
that could not pass. Each would have cost a burnt dispatch.

## Experiment E-001 — working-memory ledger, on vs off

Nine matched pairs of items, ledger on for one and off for the other, scored on first-attempt
result and on inspector findings excluding ledger-upkeep findings.

| Metric | Ledger on | Ledger off |
| --- | --- | --- |
| First-attempt PASS | 9/9 | 8/9 |
| First-attempt PASS, true first dispatches | 8/9 | 7/9 |
| Findings excluding ledger upkeep | 14 | 14 |
| Ledger-upkeep findings | 6 | 3 |
| Mean first-attempt cook context | 111,621 tokens | 86,278 tokens |
| Mean first-attempt duration | 10.1 min | 7.7 min |

**Null on outcomes, with a measured cost.** The one differing pair turns on a report-format
failure, not a work defect. The ledger cost 29% more first-attempt context, twice the upkeep
findings, and one ledger that blew its 80-line budget and needed compaction after landing.

Confounds, stated plainly: the two hardest items were assigned to the ledger arm by construction,
because the plan flagged them heavy for difficulty; cooks ran on the session model for the first
two waves and on the tier's sonnet cook afterwards, so pairs are not comparable across that
boundary; rework attempts carry a ledger in both arms, so only first attempts compare; n = 9
heterogeneous pairs. Indicative, not proof.

**Decision:** keep watching. Ledger where resumption or compaction risk is real — rework attempts
and long items — rather than on `heavy` by default, and re-run at n ≥ 20 with one cook model
across both arms.

## Proposals

| # | Destination | Proposal | Status |
| --- | --- | --- | --- |
| P1 | tooling | Validate the cook's report inside `brigade-execute` before the inspector is dispatched; hand failures back for one self-fix round | open |
| P2 | heuristic | Execute every counting Verify line against the base commit at plan time | landed in the heuristics file |
| P3 | tooling | Make `brigade-execute` resume-safe (never re-inspect an item whose landing is recorded) and inject the turn budget for over-ceiling packets | half landed: the abort-on-missing-return half shipped this dish |
| P4 | heuristic | One threshold for report evidence — literal command and output, or it is a blocking finding | landed in the heuristics file |
| P5 | installed brain | Stop dictating a literal attribution trailer in the packet template | landed this dish |

P1 is the highest-value open item. Three of the seven reworks were report-conformance failures,
which is exactly what the shipped `SubagentStop` validate hook exists to prevent — and it never
fired. Plugin-declared Stop and SubagentStop hooks are a known Claude Code defect
([anthropics/claude-code#29767](https://github.com/anthropics/claude-code/issues/29767)):
`SessionStart` from the same file fires, `Stop` never does. The workflow has no independent check
today, so the fix is to stop depending on the hook.

## Kept

**The executing plan check.** The second plan check did not read packets, it ran them in a scratch
copy, and returned six blocking items that were all folded before the first wave dispatched: two
missing acceptance-criteria owners, a smoke command that provably could not pass, an unreachable
line cap, a truncating `awk`, and the experiment's pairing design. The first four would each have
cost a dispatch; the last is the only reason the experiment is scoreable.

**Packets by pointer.** Each cook received a one-paragraph pointer to its own section of the plan
plus the command that prints it, rather than 2,100 lines of contract text pasted through a tool
argument. Zero transcription findings across 24 items.
