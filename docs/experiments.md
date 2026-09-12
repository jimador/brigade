# Experiments

An entry qualifies once it names one hypothesis, one metric, and one decision — adopt,
reject, or keep watching. Evidence lives wherever the run produced it; `.brigade/`
artifacts are local to one dish, so the entry itself must quote the actual numbers, not
just point at a path that may not exist later. A rejected hypothesis stays in this log
exactly like an adopted one — a failed experiment is a result, not something to delete.

## Template

Each entry is a level-3 heading in the form `### E-NNN <title>`, followed by:

```
- date: YYYY-MM-DD
- hypothesis: one falsifiable sentence
- setup: what ran, how it was split, what was held constant
- metric: the one number that decides it
- result: the actual number(s), or `pending` before the run lands
- decision: adopt | reject | keep watching
- evidence: path to the local artifact backing the numbers
```

## Log

### E-001 Working-memory ledger for cooks

- date: 2026-09-12
- hypothesis: a cook that keeps a bounded Canon/World-state ledger
  (`skills/brigade/MEMORY.md`) passes inspection on the first attempt more often, and
  blocks less often on packet contradictions, than one that does not.
- setup: one 21-item dish cooking this repository at three-star; ledger on for 10 items
  and off for 11, paired by item class (companion extraction, agents, reference docs,
  pointers, new features, release); cooks ran on the session model in waves 1–2 and on
  the tier's sonnet cook afterwards (a stated confound).
- metric: first-attempt PASS rate, inspector findings per attempt, BLOCKED reports, cook
  duration and tokens.
- result: null on outcomes, a measured cost. Nine ON↔OFF pairs: first-attempt PASS 9/9 ON vs 8/9 OFF (the one OFF miss was a report-format FAIL, not a work defect); inspector findings excluding ledger upkeep 14 vs 14; mean first-attempt cook context 111,621 vs 86,278 tokens (+29%); ledger-upkeep findings 6 vs 3; one ON ledger exceeded its 80-line budget and needed Planner compaction. Confounds: the hardest items were assigned ON by difficulty, cooks changed model mid-dish, n = 9.
- decision: keep watching — keep the ledger for rework attempts and cross-cutting items (where it is the audit trail), stop paying for it on small first attempts; rerun the pairing on a dish where ON/OFF is assigned at random.
- evidence: `.brigade/dishes/local-skills-best-practices/analyst.md` and
  `reports/experiment-tally.md` (local).

### E-002 Router-style SKILL.md with phase companions

- date: 2026-09-12
- hypothesis: cutting `skills/brigade/SKILL.md` from 888 to under 400 lines, with the
  phase detail moved into companion files, keeps every prompt eval passing and makes
  `claude plugin eval` score the plugin higher than without it.
- setup: this dish.
- metric: `scripts/brigade-eval` pass count (15 cases) and the `claude plugin eval`
  per-case delta.
- result: the router did not keep every prompt eval passing: on the 11 cases both trees share, `scripts/brigade-eval` (CLI backend, sonnet, one run) passed 9/11 at the base commit and 6/11 at the tip (15 cases at the tip, 7 pass; three tip failures are harness artifacts — a failed file write, a rubric-only reply, a truncated Verify step). `claude plugin eval` (8 cases, with/without ablation, one run): overall score 0.79, 5/8 pass with the plugin vs 3/8 without, mean delta +0.27; the three with-plugin failures all hit the host's Bash denial.
- decision: keep watching — do not revert the split (the plugin still beats the no-plugin baseline on every case where the plugin fires); rerun `scripts/brigade-eval` with three runs per case on both trees before ruling on the 3-case gap, and make the verdict/packet cases robust to fenced output.
- evidence: `evals/results/` (local) and the handoff report.

### E-003 Native Claude Code worktrees for cook isolation

- date: 2026-07 (approximate)
- hypothesis: Claude Code's built-in worktree support could replace brigade's steward
  choreography.
- setup: evaluated against the landing recipe — moving delivery tip as base,
  delivery-scoped branch names, a git-excluded location, rebase-then-fast-forward.
- metric: whether every landing invariant still holds.
- result: it does not — the base ref is `origin/HEAD` or `HEAD`, names are
  auto-generated, the location is `.claude/worktrees/`, and there is no landing
  choreography.
- decision: reject
- evidence: `docs/architecture.md` § Git model.
