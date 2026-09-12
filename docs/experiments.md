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
  pointers, new features, release); same model for every cook.
- metric: first-attempt PASS rate, inspector findings per attempt, BLOCKED reports, cook
  duration and tokens.
- result: pending — filled at handoff.
- decision: pending
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
- result: pending — filled at handoff.
- decision: pending
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
