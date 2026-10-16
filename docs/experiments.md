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
- evidence: [retros/2026-09-12-skill-authoring.md](retros/2026-09-12-skill-authoring.md)
  § Experiment E-001 (the per-pair table and the confounds).

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
- evidence: [retros/2026-09-12-skill-authoring.md](retros/2026-09-12-skill-authoring.md);
  raw eval output lands in `evals/results/`, which is local and never committed.

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

### E-004 The ste-80 writing preset for work packets

- date: 2026-10-02
- hypothesis: an agent given a packet whose steps follow the `ste-80` preset
  (`skills/brigade/writing/ste-80.md`) passes the packet's Verify step on the first attempt
  more often than an agent given the same packet written as packets are today.
- setup: the kit in `evals/experiments/writing-rules/` — one fixture repo (`fixture.sh`,
  plain JavaScript, `node --test`) and six work items of graded difficulty, two of them with
  a hazard a hasty reader gets wrong. Each item has a `plain.md` and a `ste-80.md` packet with
  the same files, contracts, Verify command and facts; only the writing differs. Each
  item-and-style cell runs at least three times on one model: a fresh fixture copy, one
  agent, the packet as its whole instruction, one attempt, judged by the item's hidden test
  through `verify.sh`. The grid repeats on a second model family when one is available.
  Held constant: fixture, facts, Verify command, judge and model.
- metric: first-attempt pass rate per style (passes / runs, with the run count), per model.
- result: three runs a cell, six items, two models. claude-haiku (run as an in-session haiku subagent, packet handed as a file, one line naming the fixture folder): plain 15/18, ste-80 16/18. gpt-5.5 (run with codex exec, reasoning effort low, packet as the prompt, fixture folder as the working directory): plain 18/18, ste-80 18/18. Totals: plain 33/36, ste-80 34/36. gpt-5.5 passed every run in both styles, so these six items cannot show a difference between the styles on it: they do not measure the preset on that model. On claude-haiku the styles differed on two items, in opposite directions: `2-compound-duration` plain 3/3, ste-80 2/3; `6-limiter-retry` plain 0/3, ste-80 2/3. Three runs a cell is too few to call either difference real; each is a direction, not a finding. The one-run gap on claude-haiku (1/18 of pass rate, under 6 points) is far short of the 15 points adoption needs.
- decision: keep watching — `ste-80` did not beat plain by 15 points on any model and was not lower on every model; the preset stays off by default. A rerun needs items hard enough that neither model passes every run.
- evidence: `.brigade/evals/writing-rules/results.json` (cells, totals, per-model rates and
  how each model was run), with per-run records beside it; local, never committed. The
  kit's `README.md` says how a run goes. The task of the `packet-is-model-neutral` eval case
  was run once on gpt-5.5, as the planner reading the skill's files, and the packet it wrote
  passed the case's three pattern graders and its self-contained grader; the record is
  `.brigade/evals/writing-rules/neutrality/result.json`, local, never committed.
  The three eval cases for the writing rules (`evals/packet-follows-writing-preset`,
  `evals/writing-rules-reach-ticket-comment`, `evals/packet-is-model-neutral`) were run with
  `claude plugin eval` after the last change to the graders and the preset, on sonnet with a haiku
  judge, three runs with the plugin and three without. Score with against score without, and runs
  that passed every grader: preset case 0.89 against 0.33, 2 of 3 against 0 of 3; ticket comment
  case 1.00 against 0.67, 3 of 3 against 1 of 3; neutrality case 1.00 against 0.92, 3 of 3 against
  2 of 3. The neutrality case is a guard: a careful model passes it without the plugin. The one miss
  with the plugin was a step sentence of more than 20 words. One run without the plugin read the
  repository's config file and followed the comment rules by itself. An earlier run, before two
  graders and rules S1, C1 and C3 of the preset were corrected, scored 0.78 against 0.56 on the
  preset case and 0.89 against 0.44 on the ticket comment case. Three runs an arm is a direction,
  not a rate. The records are `.brigade/evals/writing-rules/cases-2/` and `cases-3/`, local, never
  committed.

### E-005 Clause-form contracts for test packets

- date: 2026-10-16
- hypothesis: an agent given a test packet whose contract is written as numbered requires,
  ensures, invariant and law clauses, with one test asked for per clause, writes tests that
  catch more planted bugs than an agent given the same facts as prose and the template's
  "include at least one adversarial/edge case" step.
- setup: the kit in `evals/experiments/contract-tests/`: the writing-rules fixture with every
  module finished, four test-only items (`orderTasks`, `parseDuration`, the cache's `ttlMs`,
  `retryAfterMs`) and 27 planted bugs that the fixture's own tests miss and the kit's
  reference test catches. Each item has a `plain.md` and a `contract.md` packet with the same
  facts. Three runs a cell on claude-haiku as an in-session subagent, styles interleaved, one
  attempt, judged by `judge.sh` on a clean fixture holding only the agent's test file.
- metric: mutant kill rate per style (killed / mutants, with invalid runs).
- result: plain 81/81 (100%), contract 79/81 (97.5%), no invalid runs. The two survivors were
  contract runs: a second `set` that keeps the first set time (`3-cache-ttl`), and a
  `retryAfterMs` call on an unknown key that starts its window (`4-retry-after`). Both styles
  are at the ceiling, so the items cannot show a gain on this model; sonnet was not run, since
  it cannot score above a ceiling haiku already reaches. Four of the six `4-retry-after` runs
  (all three plain, one contract) reported a real contract gap that no mutant covers: with
  `limit: 0`, `retryAfterMs` returns 0 while `allow` returns false. It is a missing
  precondition (`limit >= 1`) under an exactly-when guarantee, the gap clause-form contracts
  are meant to expose, yet the prose packets surfaced it more often.
- decision: reject the clause form as the default packet format: the packet template already
  makes the planner state every fact, and with the facts stated, prose packets got haiku to
  catch every planted bug. Adopt it narrowly, on prior evidence rather than this run: a packet
  whose contract promises a guarantee a hasty test misses numbers it as a clause with its
  input domain and one test per clause, and a heavy or data-correctness item falsifies each
  clause in its Verify (`templates/work-packet.md`, Guarantee clauses). The falsification is
  the same mechanism as the bug-fix self-falsification rule, which brigade's own dishes back:
  every falsified item passed inspection first-attempt, and every one without failed at least
  once. Rerun with items whose facts are left implicit to measure the clause form itself.
- evidence: `.brigade/evals/contract-tests/haiku-scores.tsv` and the 24 test files under
  `.brigade/evals/contract-tests/tests/`; local, never committed.

### E-006 Bisect a red handoff gate

- date: 2026-10-16
- hypothesis: with a `git bisect run` rule in `HANDOFF.md` § 1, a planner facing a red full
  gate after several items landed finds the item that broke it by bisecting, in a scratch
  worktree, instead of reading diffs or testing every landed commit.
- setup: the `evals/red-gate-bisects` case: four landed items, the gate broken by the third,
  and a fourth item that only renames and comments in the same file. `claude plugin eval`
  could not grant Bash on this machine (its sandbox refuses an AWS `credential_process`), so
  the case ran as an in-session A/B: sonnet subagents told to act as the planner and read
  brigade's skill files from a frozen copy, three runs with the base text and three with the
  rule, each on its own fixture copy. Each run reported the item and every command it ran.
- metric: runs that name the right item, and runs that bisect.
- result: base 3/3 right, 0/3 bisected (each tested every landed commit in turn, in a
  throwaway worktree); rule 3/3 right, 3/3 bisected with `git merge-base` as the good end, in
  a scratch worktree they removed afterwards. Bisection is self-reported in the runs' final
  messages. The rule changes the method, not the answer: at four items a linear walk costs
  four gate runs and bisect two or three; the saving grows as log₂(N) against N on larger
  dishes with slow gates.
- decision: adopt: the rule is followed every time, costs nothing on a green gate, and the
  base text gave no instruction at all for a red one.
- evidence: the six final reports in this session's transcript; the case's fixture and
  graders are in `evals/red-gate-bisects/` for `claude plugin eval` on a machine where it can
  grant Bash.
