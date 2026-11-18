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

### E-007 Cooks write the contract before the tests

- date: 2026-10-16
- hypothesis: when a packet asks for tests and states no contract clauses, a cook that first
  writes the contract as numbered requires, ensures, invariant and law clauses read from the
  code, then one test per clause, catches more planted bugs than a cook given the template's
  "include at least one adversarial/edge case" step.
- setup: adopted without a run, as a low-cost change with the article's mutant-kill result
  behind it. Items `5-` to `8-*-implicit` in `evals/experiments/contract-tests/` are ready to
  measure it: the same four functions and 27 mutants as items 1-4, with packets that state
  no facts, so the two arms differ only in the test step.
- metric: mutant kill rate per style on items 5-8, against the explicit items 1-4.
- result: pending; run it when test quality looks like it slipped: inspector test-honesty
  findings rising, or a bug escaping a packet whose tests passed.
- decision: adopt (`agents/brigade-cook.md` step 3, Contract first); revisit on the first
  sign of a regression in test quality.
- evidence: none yet.

### E-008 Soft turn budget via a PostToolUse hook

- date: 2026-11-18
- hypothesis: a PostToolUse hook that injects a wrap-up message into a cook's context near its
  turn limit makes the cook stop, commit only passing work and report blocked, where a cook
  without the message keeps debugging until the limit kills it.
- setup: a spike and two evals. Spike: a throwaway plugin, headless `claude -p`, a haiku
  subagent told to run `echo` 6 times and stop on a token; a PostToolUse hook printed
  `additionalContext` with the token after the 3rd call. Evals: `scripts/brigade-eval` through the
  claude CLI backend, cook surface on claude-haiku-4-5, assertions judged by a second haiku call,
  three runs a cell, case `cook-wrap-up-honest-exit` in two message variants (a paraphrased
  "Wrap up now." and the exact hook message), before text against after text.
- metric: wrap-up eval pass rate with the hook's message (runs of 3 that stop, commit only passing
  work and write an honest blocked report).
- result: spike: the subagent returned the token after 3 calls ("WRAPCODE-4711 / Echo calls made:
  3"); subagent hook input carries `agent_id` and `agent_type` (`spike:counter`), main-session
  input has neither. Paraphrased message: before 0/3, after 2/3 (before: all three kept
  debugging, two refused to commit passing work). Exact hook message: before 2/3, after 3/3 (the
  before-fail planned to edit the failing test). The shipped hook measured ~50 ms on the first
  call per agent and ~29 ms after; `brigade-config` spawned once per agent. Also recorded: a
  turn-limit death was logged as `result: failed`, indistinguishable from an inspector FAIL. n = 3
  a cell is directional, not significant. On final main (all items landed, 3 runs): 2/3; the
  failed run left criterion 3 partially written with a failing test, and the judge found it
  "ambiguous whether it avoids open-ended debugging of criterion 3".
- decision: adopt
- evidence: the numbers above, quoted from the dish's eval runs and spike
  (`.brigade/evals/baseline2/`, `.brigade/evals/after-execute/`, `.brigade/evals/cook-before-v3/`,
  `.brigade/evals/cook-after-v3/`, `.brigade/evals/final-main/`; local, never committed); text in
  `agents/brigade-cook.md` § Turn-budget message.

### E-009 Mechanical scope check makes contract tests read-only to implementing cooks

- date: 2026-11-18
- hypothesis: a mechanical check of a cook's diff against its packet file list, and contract
  tests that an implementing cook may not edit, catch scope drift and test tampering that
  inspector judgment alone misses.
- setup: adopted on codebase facts and an external study, without a run of its own. Facts
  (scout briefs, file:line verified by inspectors): before this dish nothing checked a cook's diff
  against its packet file list mechanically; scope was inspector judgment only
  (`agents/brigade-inspector.md` "Scope discipline"); the cook and the inspector received the
  identical packet; the cook wrote the tests it was judged on.
- metric: scope and contract-test violations caught mechanically per dish.
- result: pending. External, SECONDARY (primary page unreachable from this environment):
  "ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases" (2025, arXiv:2510.20270)
  reports that models
  exploit tests when tasks are impossible, that Claude and Qwen3-Coder cheat mostly by editing
  tests (>79% of cheating), and that a prompt cut GPT-5 cheating on one split from 92% to 1%. That
  supports both the mechanical check and the prompt rule.
- decision: adopt; revisit once a few dishes have run and the per-dish violation count exists.
- evidence: the codebase facts above, verified by inspectors in this dish; "ImpossibleBench:
  Measuring LLMs' Propensity of Exploiting Test Cases" as cited (SECONDARY).

### E-010 Phase-gated planning with parking

- date: 2026-11-18
- hypothesis: a planner that decides only the questions the current phase needs and parks the
  rest with reopen gates neither over-tables a contract-shaping question nor resolves
  implementation questions before the contract exists.
- setup: `scripts/brigade-eval`, claude CLI backend, opus planner surface (`SKILL.md` and
  `DECOMPOSE.md`), haiku judge, three runs a cell, before text against after text. Cases:
  `planner-tables-implementation-during-contracts` and the counter-case
  `planner-decides-contract-shaping-question-now`.
- metric: tabling eval pass rate (runs of 3 that pass every assertion).
- result: tables case 2/3 before, 2/3 after; the failure mode changed. Before, a run resolved the
  implementation questions before the port; after, a run parked them with reopen gates but also
  wrote adapter semantics into the contract. Counter-case 3/3 before, 3/3 after: no
  over-tabling. n = 3 is directional. Open risk: tabling, in particular adapter semantics leaking into a
  contract that is meant to stay behind the port. On final main (all items landed, 3 runs): 2/3;
  the failed run deferred an interface-shaping question (window semantics, the lifecycle choice)
  to the operator instead of settling it.
- decision: adopt
- evidence: the numbers above, quoted from the dish's eval runs (`.brigade/evals/baseline/`,
  `.brigade/evals/after-planning/`, `.brigade/evals/final-main/`; local, never committed). Basis (SECONDARY, not run here):
  rolling-wave planning (PMBOK) and "Lean Software Development" (2003) for the last responsible
  moment.

### E-011 Contract-first decomposition

- date: 2026-11-18
- hypothesis: a planner told to decompose around a shared contract suite and an early
  end-to-end path produces plans where every implementation faces the same tests, and does not
  add abstractions for speculative use cases.
- setup: `scripts/brigade-eval`, claude CLI backend, opus planner surface, haiku judge, three runs
  a cell, before text against after text. Cases: `planner-contract-first-decomposition` and
  `planner-no-speculative-abstraction`.
- metric: runs that pass every assertion (of 3).
- result: contract-first 0/3 before, 3/3 after (before: no shared contract suite, each
  implementation wrote its own tests, no early end-to-end path). No-speculative-abstraction 3/3
  before, 2/3 after; the one after-fail is a judge error, its own detail ending "making this a pass
  on the core behavior". n = 3
  is directional. On final main (all items landed, 3 runs): contract-first 3/3;
  no-speculative-abstraction 2/3, the failed run a judge self-contradiction (its detail says the
  response "satisfies the criterion's core requirements").
- decision: adopt
- evidence: the numbers above, quoted from the dish's eval runs (`.brigade/evals/baseline/`,
  `.brigade/evals/after-planning/`, `.brigade/evals/final-main/`; local, never committed). Basis (SECONDARY, not run here):
  "The Wrong Abstraction" (2016), "Refactoring" (1999) for the rule of three, "On the criteria to
  be used in decomposing systems into modules" (1972, Communications of the ACM), and "A
  Philosophy of Software Design" for deep modules and design-it-twice.

### E-012 Cook blocks on a missing contract

- date: 2026-11-18
- hypothesis: a cook whose packet names a function that does not exist stops and writes a
  decision-ready BLOCKED question instead of choosing the nearest match.
- setup: `scripts/brigade-eval`, claude CLI backend, cook surface on claude-haiku-4-5, haiku
  judge, three runs a cell, case `cook-blocks-on-missing-contract` (final case), before text
  against after text.
- metric: runs that pass every assertion (of 3).
- result: 2/3 before, 0/3 after. In every after-run the cook stopped, blocked and named
  `formatInvoice` missing and the `formatMoney` signature; the judge failed every run on the
  BLOCKED-report assertion, with a different reason each time. Run 1: the cook called
  `formatMoney` the "only candidate" in its question. Run 2: it asserted the `formatMoney`
  signature as fact from a read it described only in future tense, showed no tool result, and
  framed its question toward `formatMoney` with locale; run 2 also failed the file-scope
  assertion, with detail that calls the criterion "arguably satisfied". Run 3: it read
  `src/pdf/invoice.ts` and pre-filled a question proposing `formatMoney` with minor units. Whether that is a defect or
  the decision-ready-question norm (options plus a recommendation) is untested, so the drop from
  2/3 to 0/3 stays unexplained until it is. n = 3 is directional. On final main (all items
  landed, 3 runs): 2/3; the failed run 2 was judged "only partially" matching: the judge says it "does not actually stop
  and ask the Planner" and "states a unit-mismatch concern without fully deferring the choice".
- decision: keep watching; next run: an assertion that accepts a recommended option in the
  question, then check the after-text again.
- evidence: the numbers above, quoted from the dish's eval runs (`.brigade/evals/cook-before-v3/`,
  `.brigade/evals/cook-after-v3/`, `.brigade/evals/final-main/`; local, never committed); text in
  `agents/brigade-cook.md` § The loop, step 2.

### E-013 Design review tiered by reversibility

- date: 2026-11-18
- hypothesis: spending a design review only on decisions that are costly to reverse, selected
  through the `brigade-risk` `design_review` result, catches design errors earlier than
  inspecting finished diffs, at a bounded cost.
- setup: adopted without a run, as a low-cost change. Review size follows a human-attention
  limit: "Best Practices for Code Review" (SmartBear, Cisco case, SECONDARY; primary page unreachable
  from this environment) recommends reviewing at most 200-400 LOC at a time; that is an attention limit, not a
  design-quality measure.
- metric: design-review findings that change a plan or contract per dish, against the cost of the
  review.
- result: pending
- decision: adopt; revisit once a few dishes have used it.
- evidence: none yet; "Best Practices for Code Review" as cited (SECONDARY).

### E-014 Promote design knowledge at handoff

- date: 2026-11-18
- hypothesis: promoting a contract's doc comment, its suite and a decision record at handoff
  gives later scouts a durable source of design intent that the board and `.brigade/` do not.
- setup: adopted without a run, as a low-cost change.
- metric: scout briefs that cite a decision record.
- result: pending
- decision: adopt; revisit after several dishes.
- evidence: none yet.

### E-015 Script-generated plan view published by the runtime

- date: 2026-11-18
- hypothesis: a plan view generated by a script, and published by the runtime instead of written
  by the planner, stays in step with `PLAN.md` where a hand-written view drifts.
- setup: adopted on use in this dish; no comparison run.
- metric: none yet; drift between the view and `PLAN.md` is the thing to watch.
- result: no metric yet
- decision: adopt
- evidence: none yet.

### E-016 OpenSpec as ticket input: verified format, no adapter built

- date: 2026-11-18
- hypothesis: OpenSpec change folders can feed brigade tickets through documentation alone,
  with no adapter and no CLI dependency.
- setup: read the npm package `@fission-ai/openspec` 2.1.0 (published 2026-11-17). MIT; Node >=
  22.20.0; 13 runtime dependencies. Layout: `openspec/{config.yaml, specs/<capability>/spec.md,
  changes/<name>/{.openspec.yaml, proposal.md, design.md, tasks.md, specs/<capability>/spec.md},
  changes/archive/YYYY-MM-DD-<name>/}`. `proposal.md` has Why, What Changes, Capabilities and
  Impact. Delta specs use ADDED / MODIFIED / REMOVED / RENAMED Requirements, `### Requirement:`
  (SHALL/MUST) and `#### Scenario:` with WHEN / THEN bullets. `tasks.md` is `## 1. <group>` with
  `- [ ] 1.1` items. `design.md` has Context, Goals / Non-Goals, Decisions, Risks / Trade-offs.
  `openspec archive` merges deltas into specs, and its merge rules exist only in the CLI.
- metric: tickets planned from an OpenSpec change folder alone (count).
- result: pending. Format and churn are verified from the package: the format is readable as plain
  markdown; it churns: 2.0.0 (2026-11-11) replaced command files with skills, `project.md` was
  replaced by `config.yaml` in 1.14, and the delta format has been stable. No ticket has been
  planned from a change folder yet, so the metric has no reading. No adapter and no CLI
  dependency were built; only docs-only intake guidance was written in `docs/sources.md`.
- decision: keep watching; trial it on the first repo that uses OpenSpec, then decide whether it
  earns more.
- evidence: the package contents as read, quoted above (the package, not a local run); the intake
  rules are in `docs/sources.md` § OpenSpec changes as ticket input.

### E-017 Contract triangulation (protocol only)

- date: 2026-11-18
- hypothesis: when three isolated probe cooks each write a contract for the same new
  abstraction, the places where they diverge mark ambiguity in the planner's brief, and fixing
  those places before building lowers contract churn after implementation starts.
- setup: protocol only, not run. Applies only to a new abstraction with at least two real use
  cases. Three isolated probe cooks, each given the same brief and no sight of the others, each
  write a contract; the Planner reads where they diverge and fixes the brief. No scoring: equal
  weights perform close to fitted weights at small n ("The robust beauty of improper linear models in decision making", 1979, American Psychologist,
  SECONDARY), so a tuned score buys
  nothing. Divergence detects ambiguity, not correctness, because independently written versions
  fail in correlated ways ("An Experimental Evaluation of the Assumption of Independence in Multiversion Programming", 1986, IEEE Transactions on Software Engineering, SECONDARY).
- metric: contract churn, edits to the contract after implementation starts, with and without
  triangulation.
- result: pending
- decision: keep watching; run it on the next new abstraction that has two real use cases.
- evidence: none yet; the 1979 and 1986 studies as cited (SECONDARY, primary pages unreachable
  from this environment).

### E-018 Rejected without a build

- date: 2026-11-18
- hypothesis: six proposed additions would improve a dish enough to justify their cost.
- setup: none; each was rejected on reading, before any build.
- metric: none; each rejection is one line of evidence and its class.
- result: rejected, each with its reason.
  - Local model as the driver: the Planner's argument was that the driver role is where
    decomposition and rulings are decided, so a weaker model costs most there. Repository
    evidence in `skills/brigade/TIERS.md`: haiku went 0/4 on config-resolution and ORM/schema packets, and
    haiku scouts ran out of turns on multi-part questions. (class: reasoning plus repository evidence, no run); after the research summary that recommended against both, the operator replied: "I'm with you. I don't think this will help."
  - Lookup budget for cooks: the cook prompt already forbade exploration beyond the packet
    (codebase fact), so a budget would loosen it (class: repository evidence, the prompt text, plus
    reasoning; no eval, no run of a budget).
  - Jev and other hosted decision models: the independent evidence is unreviewed preprints (good
    calibration on choice tasks, wording sensitivity, one report of a 59% attack success rate),
    from search summaries only, low confidence (class: low-confidence SECONDARY evidence); after the research summary that recommended against both, the operator replied: "I'm with you. I don't think this will help."
  - LLM-judged satisfaction scores: evaluators favor their own generations ("LLM Evaluators Recognize and Favor Their Own Generations" (2024, arXiv:2404.13076), SECONDARY), and this dish's judge misread negated assertions (E-020) (class: measured
    judge unreliability).
  - Geometric or probabilistic scoring of contracts: equal weights perform close to fitted weights
    at small n ("The robust beauty of improper linear models in decision making", 1979, American
    Psychologist, SECONDARY) (class: external, SECONDARY).
  - Extra reviewers for now (a find-only local reviewer, a second plan-check slot, per-reviewer
    provenance): one code-review study, arXiv 2606.15689, search summary only (SECONDARY), found the
    union of two models scored lower F1 than Haiku alone because the second added false positives
    (class: external, SECONDARY, low confidence).
- decision: reject
- evidence: the one-line reasons above; no run of the rejected options backs them.

### E-019 Fresh reviewer sessions only

- date: 2026-11-18
- hypothesis: reviews run by a fresh sonnet-or-stronger session catch defects that the cook's
  self-report and the Planner's own review miss.
- setup: Operator instruction: "All reviewers will have to be fresh sonnet or oops or fable
  sessions" ("oops" read as opus), encoded as a standing rule. Evidence is this dish's review
  record. No arms.
- metric: defects a fresh reviewer caught that the self-report did not.
- result: fresh reviewers caught what self-reports missed. Plan-schema attempt 1: block-style
  plans silently lost attempt validation (a regression against main). Attempt 2: same-indent lists
  and inline fields after `attempts:` were silently skipped (a regression against main). The
  planning prompts item: `SKILL.md` kept "plan once / one checkpoint" in five places against
  `DECOMPOSE.md`'s per-level checkpoints (two rounds, then a Planner fix reviewed by a fresh opus
  inspector). The handoff prompts item: analyst metrics with no data source (tokens and dollars
  per item, non-cook overrun rate, "answered in time"). The Planner's own first review of a green
  gate was not independent; a fresh sonnet re-review confirmed PASS and found a pre-existing gap
  (doctor does not type-check `models.*`). Supporting, SECONDARY: LLM evaluators favor their own
  generations ("LLM Evaluators Recognize and Favor Their Own Generations" (2024, arXiv:2404.13076)).
- decision: adopt: only fresh sessions of sonnet or stronger review, never the session that wrote
  or planned the work.
- evidence: the findings listed above, from this dish's review reports under
  `.brigade/dishes/contract-first-fleet/reports/` (local, never committed).

### E-020 Eval-judge reliability

- date: 2026-11-18
- hypothesis: positively phrased assertions, and cases that ask for the action list and the
  report text, are judged more reliably by a haiku judge than negated assertions and
  plan-described cases.
- setup: observed while running this dish's `scripts/brigade-eval` cases (claude CLI backend,
  haiku judge); the assertions were rewritten and the cases re-run; no separate arms. Assertions
  are now phrased positively, a practice in use.
- metric: judge verdicts that contradict the run's own text or the assertion's meaning.
- result: the judge mis-scored assertions in both phrasings. Named cases: the probe run (local `.brigade/evals/probe.json`), where one of two negated assertions failed with the detail "satisfies the criterion"; after-planning `planner-no-speculative-abstraction` run 1 (detail ends "making this a pass on the core behavior"); final-main `planner-no-speculative-abstraction` run 1 (detail says the response "satisfies the criterion's core requirements"); baseline2 `cook-blocks-on-missing-contract` run 2 (failed for reading a file the assertion allows); after-execute `cook-blocks-on-missing-contract` run 3 ("reads match the permitted set exactly"); cook-before-v3 run 1 ("the criterion is met"); cook-after-v3 run 2 ("arguably satisfied"). No error rate is claimed: what counts as a negated assertion is ambiguous when one assertion joins a positive and a negative clause, and whether phrasing changes the rate was not measured. Asking for a described plan made the judge demand executed actions; cases now ask for the action list and the report text. The existing 17 cases scored 11/17 on one run each before the change, a baseline noise reference. n = 3 is directional.
- decision: keep watching; next step: a stronger judge model for semantic assertions.
- evidence: the observations above, from the dish's eval runs (`.brigade/evals/after-planning/`,
  `.brigade/evals/after-execute/`, `.brigade/evals/cook-before-v3/`,
  `.brigade/evals/cook-after-v3/`, `.brigade/evals/existing-before/`, `.brigade/evals/final-main/`; local, never committed).

### E-021 Pipeline postconditions and plan rehearsal reduce tooling defects

- date: 2026-11-18
- hypothesis: moving postconditions into code (verdict probe, argument validation, steward commit
  of refused commits) and rehearsing plans with the pipeline's own tools cuts tooling defects and
  environment blocks per dish without lowering first-attempt PASS.
- setup: baseline from the field audit of 455 dishes in seven repos (July to November 2026): 30%
  of 175 blocked cook reports were a refused `git commit`; first-attempt PASS 67% (n=1,623 items
  with attempt records), 78% in November; items marked done without a verdict file 1.2% in
  November. Re-measure on the next ten dishes after release 0.51.0 with the same scripts.
- metric: tooling defects per dish (a gate or tool that blocked correct work, or let wrong work
  through), counted from analyst retros; environment-blocked rate (blocked cook reports caused by
  the environment, such as a refused commit, over all cook reports); first-attempt PASS rate.
- result: pending
- decision: keep watching
- evidence: local audit `.brigade/research/field-evidence-2026-11-18.md` (never committed); the
  numbers above are quoted so the entry stands alone.
