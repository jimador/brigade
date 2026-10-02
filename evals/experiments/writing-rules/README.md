# Writing-rules experiment kit (E-004)

This kit answers one question: does an agent pass its Verify step on the first attempt
more often when the packet's steps follow the `ste-80` writing preset
(`skills/brigade/writing/ste-80.md`) than when the packet is written the way packets are
written today? The entry for it is E-004 in `docs/experiments.md`.

The kit only sets the experiment up. Nothing here runs a model.

## What is in the kit

- `fixture.sh` builds `acme-utils`, a small plain-JavaScript repo with six modules (slug
  maker, duration parser, cache, date-range parser, task list, rate limiter) and a passing
  `node --test` suite. Run it in an empty folder; it needs only `git` and `node`.
- `items/<n>-<slug>/` holds one work item:
  - `plain.md` — the packet in today's style: terse paragraphs, several instructions to a
    sentence, the same sections packets in this repo use.
  - `ste-80.md` — the same packet written to the `ste-80` preset: one instruction per
    sentence, no step sentence over 20 words.
  - `hidden.test.js` — the judge. It checks only facts that both packets state.
  - `verify.sh` — run from the root of a fixture copy with no arguments. It copies
    `hidden.test.js` into the copy's `test/` folder, runs `node --test` on that one file,
    and exits with its status: 0 means the item is done.
  - `solution.patch` — a reference solution, so the kit can prove each item is solvable.
- `selfcheck.sh` proves the kit: exactly six items, and for each one a fresh fixture fails
  `verify.sh` and passes it once `solution.patch` is applied. It prints `ok <item>` per item
  and stops non-zero at the first problem.

The six items, easiest first:

| Item | Change | Hazard for a hasty reader |
|------|--------|---------------------------|
| `1-slug-separator` | `slugify` takes a separator option | — |
| `2-compound-duration` | `parseDuration` reads `2d` and `1h30m` | — |
| `3-cache-ttl` | cache entries expire after `ttlMs` | — |
| `4-range-days` | `countDays` and `eachDay` for a date range | off by one (both ends count); must not mutate the range's dates |
| `5-order-tasks` | `orderTasks` by priority, then due date | `sort` mutates the input; undated tasks go last |
| `6-limiter-retry` | rate limiter takes `window: '5m'` and gains `retryAfterMs` | — |

Both packets of a pair name the same files, contracts, Verify command (`node --test`) and
facts. The plain packet is the control, so it is complete and correct, not a strawman. Item
4's hidden test runs in a time zone west of UTC, which is what the packets' "UTC only"
hazard warns about.

## Before a run

Prove the kit still holds:

```bash
bash evals/experiments/writing-rules/selfcheck.sh
```

It prints `ok` for all six items. If it does not, fix the kit before spending any runs.

## How a run goes

A cell is one item in one style. For each cell:

1. Make a fresh folder outside this repo and run `fixture.sh` in it.
2. Give one agent the packet (`plain.md` or `ste-80.md`) as its whole instruction, with the
   fresh folder as its working folder. Add nothing to the packet, and keep the kit out of
   the agent's reach: it must never see `hidden.test.js` or `solution.patch`.
3. Let the agent work once. No retries, no follow-up messages, no hints.
4. Run `verify.sh` from the root of that folder and record pass (exit 0) or fail.

```bash
kit=/path/to/repo/evals/experiments/writing-rules
item=4-range-days
style=ste-80
work=$(mktemp -d)
(cd "$work" && bash "$kit/fixture.sh")
# Hand "$kit/items/$item/$style.md" to the agent, working in "$work", and let it finish.
(cd "$work" && bash "$kit/items/$item/verify.sh"); echo "exit=$?"
```

Run every cell at least three times with the same model: six items, two styles and three
runs make 36 runs per model. Interleave the styles rather than running all of one style
first, so a change in the model service does not line up with one style. When a model from a
second model family is available, repeat the whole grid with it and keep its numbers
separate.

Record one line per run in `.brigade/evals/writing-rules/` (local, never committed), for
example:

```
item	style	model	run	verify_exit	result
4-range-days	ste-80	model-a	2	0	pass
```

## The metric

First-attempt pass rate per style: passes divided by runs, always with the count of runs,
for example `ste-80 14/18` against `plain 12/18`. Give it per model, and give the two hazard
items (4 and 5) on their own as well, since that is where clearer steps should matter most.

At this size the result is directional, not proof. Six items and a few dozen runs cannot
separate a real effect from noise when the styles differ by one or two passes; read a gap
that small as "keep watching", and read a large, repeated gap as a reason to build a bigger
item set, not as a settled answer.
