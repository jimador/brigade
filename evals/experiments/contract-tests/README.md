# Contract-tests experiment kit (E-005)

This kit answers one question: when a packet states its contract as numbered clauses
(requires, ensures, invariant and law) and asks for one test per clause, do the tests an
agent writes catch more bugs than when the packet states the same facts in prose and asks
for "at least one adversarial/edge case", the way the packet template asks today? The
entry for it is E-005 in `docs/experiments.md`.

It measures tests the way mutation testing does. Each item names one finished, correct
function and asks only for tests. The judge then plants known bugs in the function, one
at a time, and counts how many of them the agent's tests catch.

The kit only sets the experiment up. Nothing here runs a model.

## What is in the kit

- `fixture.sh` builds `acme-utils` from the writing-rules kit (`../writing-rules`) with the
  source half of every item's solution applied, so all six modules are finished, and only
  the original tests. Run it in an empty folder; it needs only `git` and `node`.
- `items/<n>-<slug>/` holds one work item:
  - `plain.md` — the packet in today's style: the facts as a prose paragraph, and the
    template's test step ("name the cases; include at least one adversarial/edge case").
  - `contract.md` — the same facts as numbered clauses (`R` requires, `E` ensures, `I`
    invariant, `L` law), and a test step that asks for at least one test per clause.
  - `test-file` — the path of the one file the packet lets the agent create.
  - `mutants/*.json` — the planted bugs. Each is one or more exact find-and-replace edits
    to one source file, with a line saying what the bug is.
  - `reference.test.js` — the kit's own complete test, never shown to an agent.
- `mutate.js` applies one mutant to a fixture copy. Each find string must occur exactly
  once, so a mutant that drifts from the source fails loudly.
- `judge.sh <item folder> <fixture copy>` scores one run. It copies only the agent's test
  file into a fresh fixture, so a change the agent made to `src/` cannot count. The run is
  valid when that test file passes on the finished source. It then runs the test file once
  per mutant; a failing run kills the mutant.
- `score.sh <runs folder>` judges every run folder and prints the kill rate per model and
  style.
- `selfcheck.sh` proves the kit: the reference test passes on the finished source and kills
  every mutant, and the fixture's own tests pass on every mutant, so each mutant is a real
  behavior change that only new tests can see. It prints `ok <item> (<n> mutants)`.

The four items and what their mutants break:

| Item | Function | Mutants |
|------|----------|---------|
| `1-order-tasks` | `orderTasks` | sorts in place, drops done tasks, copies the task objects, undated first, latest date first, unstable ties (dated and undated) |
| `2-parse-duration` | `parseDuration` | accepts an empty string, no trimming, keeps only the last part, any part order, a repeated unit, a 12-hour day, decimals |
| `3-cache-ttl` | the cache's `ttlMs` | expires one tick late, a read restarts the time, a second set keeps the old time, `ttlMs: 0` never expires, an expired entry stays in `size`, a default time to live |
| `4-retry-after` | `retryAfterMs` | off by one, the full window instead of the time left, a wait while a call is left, the query uses up a call, the query starts a window, another key's window, both window options accepted |

Items `5-order-tasks-implicit` to `8-retry-after-implicit` reuse those functions, mutants and
reference tests with packets that state no facts: the goal, the signature, a one-line
summary and the pasted code. Their `contract.md` asks the agent to write the contract as
numbered clauses first, read from the code, then one test per clause; their `plain.md` keeps
the template's test step. They measure E-007, the cook's Contract first rule.

Both packets of a pair state the same facts. Every mutant breaks a fact that both
packets state, and the prose packet is complete and correct, not a strawman.

## Before a run

```bash
bash evals/experiments/contract-tests/selfcheck.sh
```

## How a run goes

A run is one item in one style. For each run:

1. Make a folder outside this repo named `<model>-<item>-<style>-<run>`, run `fixture.sh`
   in its `repo/` subfolder, and copy the item's packet beside it as `PACKET.md`.
2. Give one agent this line and nothing else: "Your working folder is `<folder>/repo`.
   Your whole instruction is the work packet in `<folder>/PACKET.md`. Read it and carry it
   out in that folder. Work only inside that folder." Keep the kit out of its reach.
3. Let the agent work once. No retries, no follow-up messages, no hints.

Run every cell three times per model and interleave the styles. Then:

```bash
bash evals/experiments/contract-tests/score.sh /path/to/runs
```

Keep the scores in `.brigade/evals/contract-tests/` (local, never committed).

## The metric

Mutant kill rate per model and style: mutants killed over mutants in all runs, with the
count of invalid runs beside it. The decision rule: adopt clause-form contracts when they
beat prose by at least 15 points of kill rate on every model run and produce no more
invalid runs; reject them when they are lower on every model; otherwise keep watching.
Four items and a few dozen runs give a direction, not proof.
