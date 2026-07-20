# Work packet format

Every work item in `PLAN.md` carries one packet in exactly this shape. The packet is the
ONLY context a Cook gets — subagents cannot see the planning conversation, the ticket, or
the scout briefs. If it isn't in the packet, it doesn't exist. Write packets like you're
briefing a competent junior who starts in five minutes and can't ask questions.

Packets use typed steps — Explore, Implement, Verify — with two hard rules the Cook
enforces: **Explore steps come first and are strictly read-only**, and **every packet ends
with a Verify step whose failure stops the Cook** (report BLOCKED, never merge-hope).
Cooks have no Propose/Review steps — the Planner's plan checkpoint and the Inspector gate are
those steps, lifted out of the packet.

---

## <item-slug> — <one-sentence behavior, no "and">

- **branch:** wip/<delivery-slug>/<item-slug>
- **worktree:** .brigade/worktrees/<delivery-slug>--<item-slug>   (absolute path at dispatch)
- **depends_on:** [<item-slug>, ...] | none
- **heavy:** false            # true → dispatches to the sonnet Cook from the start
- **files:** the ONLY files you may touch
  - path/to/file.ts (edit)
  - path/to/new-file.test.ts (create)

### Goal

One short paragraph: the behavior to exist when you're done, and why (one sentence of
context so the Cook makes sane micro-decisions).

### Contracts you code against

The exact signatures/types/schemas this change must fit — pasted, not referenced:

```ts
// pasted from src/foo/types.ts (do not modify this file)
export interface Widget { id: string; render(): Node }
```

### Current behavior (pasted anchors)

The relevant existing snippet(s), quoted with file path, so the Cook lands the edit in the
right place without searching:

```ts
// src/foo/registry.ts, in registerDefaults():
registry.add(new BarWidget())
```

### Preconditions & hazards

Only when they apply — omit the section if neither does:

- **Named input-hazard.** If the target module already defends against a specific input-hazard
  class (delimiter-unsafe free text, nullable-key MERGE collisions, stale snapshots, etc.),
  name that hazard here, forbid the known-wrong shortcut (never string-parse a rendered form
  when a structured source exists; never delimit-encode free text), and require the Step 3
  adversarial test to target it specifically — against real infra (a testcontainer) for
  data-correctness changes, never a fake that returns canned rows. If the module lacks that
  real-test infra, standing it up is in scope for this packet, not a reason to fall back to fakes.
- **Finding-derived premise.** If this packet comes from a review/audit finding, name the exact
  command that confirms the finding's premise (e.g. `git grep <symbol>`). If it contradicts the
  premise, the Cook reports `status: done` with zero file changes and the command's output as
  evidence — a false premise resolves to a safe no-op, never a blind edit.
- **Guarantee-class claim.** If the packet's contract promises a concurrency/exclusivity
  guarantee (CAS, exactly-one-winner, mutual exclusion, "serializes on") the packet MUST
  include a concurrent-caller test in ITS OWN acceptance criteria — N concurrent callers →
  exactly one success, at N and 10N — never deferred to a downstream load/perf item; serial
  crash/atomicity suites do not exercise it. If the hazard class is security (path traversal,
  symlink escape, injection, authz bypass), require a live adversarial probe against a hostile
  fixture as PASS evidence, and write any framework-mechanism fixture (AOP, proxying,
  interception) in the language's DEFAULT shape, asserting the mechanism FIRED, not that it
  is wired.
- **Bug-fix self-falsification.** A packet fixing a bug requires the Cook to reintroduce the
  bug, paste the red run, restore the fix, and paste the green run — a fix whose test never
  goes red on the broken code is tautological. The same red-to-green requirement applies to
  any packet whose hazard class is async/ordering/hang or stale-reference, heavy-flagged or
  not: every falsified item across two dishes passed inspection first-attempt; every one
  without a falsify step failed at least once.
- **Banned pattern.** A packet that forbids a specific code pattern includes a mechanical
  gate in its Verify (`git diff <base>...HEAD | grep -c '<pattern>'` expected 0) AND pastes
  the literal correct replacement in the Implement step — a prose-only ban does not change
  what the Cook writes (the same cast defect recurred 5 times across two dishes despite an
  explicit per-packet ban).
- **Git/filesystem choreography.** When acceptance hinges on a git or filesystem side-effect
  recipe (branch delete, rebase-then-merge, worktree teardown), the Verify runs the actual
  recipe against a scratch repo — token/shape greps let a topology bug survive two FAIL
  rounds. And an assertion that a side-effect did NOT happen pins the exact location and
  the ACTUAL command that would produce it (the spawned process's cwd, each route's real
  mutating command) — a blanket check at the wrong location passes through real regressions.
- **Self-referential tooling.** A packet that tests or edits the session's own guards,
  hooks, or command classifiers must build hazard tokens (heredoc markers, staging flags,
  banned patterns) by string concatenation inside a script — never as literal text in the
  cook's own Bash commands — because the installed tooling scans every agent's command
  text and will refuse the fleet's own work mid-dish.

### Steps

1. **Explore (read-only, ≤ N files):** read the files listed above — nothing else. If
   reality contradicts this packet (missing file, different signature), STOP and report
   BLOCKED with what you found. Do not improvise around a wrong packet.
2. **Implement:** <precise change 1>.
3. **Implement:** <precise change 2 — including the new test: name the cases; at least one
   adversarial/edge case (malformed input, empty/null boundary, error path), not just the
   happy path>.
4. **Verify (must pass):**

```bash
<exact command(s) — e.g. bun test src/foo/registry.test.ts && bun run types>
```

### Acceptance criteria

- [ ] <observable outcome 1>
- [ ] <observable outcome 2>
- [ ] New/updated tests cover the behavior incl. one adversarial case
- [ ] Verify commands pass; output pasted in the report

### Conventions

<the 2–4 repo conventions that apply to THESE files — from config "Local conventions" +
anything a scout brief flagged. e.g. "imports at top; exhaustive switch with never default;
no new dependencies.">

### Out of scope

Name the tempting-but-forbidden things explicitly: files not to touch, refactors not to do,
adjacent bugs to leave alone (report them instead).

---

## Packet quality bar (Planner self-check before dispatch)

- Could a stranger with zero repo knowledge complete this from the packet alone?
- Are all contracts/anchors **pasted**, not "see file X"?
- Is every step unambiguous — no "appropriately", "as needed", "look around"?
- 1–3 files, ≤ ~150 lines, one behavior, mechanically verifiable?
- Does the Verify step actually prove the acceptance criteria, and can it fail? (Exit-code
  hygiene: never `cmd | tail; echo $?` — pipe status masks the build's code. Include the
  repo's lint check scoped to the packet's files when one exists. A packet editing a file
  that already has tests runs ALL of that file's existing test classes in Verify — find
  them with `git grep -l <ClassUnderTest>` — not only the newly named ones.) Three proofs
  of can-it-fail: a property/soundness test asserts its own non-vacuity (fail if the count
  of cases exercising the property is zero); a code path that can fall back to a live
  global binary gets a deterministic override plus a hermeticity canary (nonsense input,
  known output); a "pre-existing failure" claim is verified only in a fully-installed real
  checkout, never a symlinked or freshly-isolated worktree.
- Is every stated premise verified against source, not memory: cited precedent tests read at
  line level (what calls they actually make), library/third-party contracts read from the
  actual sources, lookup/query behavior quoted from the query builder, external-API claims
  tagged with a primary source? Dry-run every self-check/grep gate on the base branch —
  confirm it fails for the right reason and cannot force a code change just to satisfy the
  grep.
- Is every named hazard paired with a matching acceptance-criterion test? Guidance without a
  test leaves the regression path open.
- Is every expected runtime string or output that another packet also asserts — or that came
  from a scout brief — captured from a real execution and pasted verbatim into each packet
  that uses it? Never re-derive or analogize a shared value per packet; run the case once
  and paste what it printed.
- If the module defends against an input hazard, or the packet came from a finding: is the
  hazard/premise named, the wrong shortcut forbidden, and a targeted adversarial test required
  (real infra for data-correctness)?
- On a `heavy: true` item, remember the packet seeds the cook's protected Canon
  verbatim — a vague contract here becomes a vague invariant held for the whole cook.
- When a scout brief contains an EXECUTED, working construction of something the packet
  needs (a payload, an invocation, a repro), paste that snippet verbatim — never re-derive
  it from memory; re-derivation is where the defects enter (a hand-rolled repro payload
  was invalid JSON that died before reaching the code under test, while the brief's
  executed version worked).

Any "no" → keep researching or keep splitting. A vague packet costs more in FAIL loops
than the planning tokens it saved.
