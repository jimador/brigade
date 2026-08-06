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
  When the change interpolates variable text into a delimited syntax (wikilinks, markdown
  links, HTML, template strings), the adversarial case uses that syntax's own delimiters as
  the payload — never leave the hostile input to the Inspector's imagination.
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
  explicit per-packet ban). When the banned pattern is what the obvious implementation reaches
  for, name the sanctioned technique too — three cooks independently wrote the identical
  forbidden cast because the packet said what not to do and never what to do instead.
- **Format, shape, and layout criteria.** A packet constraining a value's FORMAT (id shape,
  hex length, prefix convention) pastes both a conforming and a non-conforming fixture literal
  into the acceptance criteria — a prose-only format rule ships tests whose fixtures never
  exercise the filter, so the named test cannot fail. A criterion about alignment, column
  position, or layout ships a computed assertion in Verify (a script recomputing the expected
  offset); a cook's prose claim of having checked the formatting is not evidence.
- **Derived identity.** When the identity or key a feature displays or groups by is derived
  rather than declared (source name from a file name, principal from an env secret, id from a
  path), state the derivation rule in the packet and, where the platform allows it, add a
  build-time uniqueness check. A derived-identity collision is invisible to per-item review
  because no single item owns the derivation.
- **Externally mutable state.** A packet reading state that can change under it (git HEAD, a
  cursor, a high-water mark) resolves it ONCE and threads the captured value through every
  use, and the falsification step proves the resolve-once property: inject a change between
  two uses and show nothing is skipped.
- **Self-catch and re-entry.** A packet adding a `throw` of type X inside a try/catch that also
  handles X names that hazard explicitly and says how to resolve it — usually by narrowing what
  the `try` guards.
- **Real input, real dispatch.** A behavior change to a config or input parser is verified
  against the operator's REAL config file, not only fixtures — zero false positives on the live
  file is the acceptance bar. A content bundle the platform loads and then calls (a plugin, a
  pack, a realm) ships a test that invokes it through the real seam and asserts the recorded
  call's arguments; "it loads" is never evidence that it runs.
- **Unexported code under test.** A test-only packet targeting unexported code pre-sanctions
  the minimal seam (the export keyword, the extraction) or tells the Cook in as many words that
  BLOCKED beats faking coverage. An impossible honest path plus a done-bias produces retyped
  copies and tautologies, not blocked reports.
- **User input in a shell template.** A packet authoring a command doc, script, or prompt that
  templates user input into shell NEVER shows the raw value inside the command: validate it
  against an explicit character class first (refuse and stop on mismatch), then pass it as a
  single-quoted argument, with the same validation repeated inside the script itself. A
  hostile-input case goes in the Verify.
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
- Does the Verify step actually prove the acceptance criteria, and can it fail? A
  `grep -q` for an identifier's PRESENCE proves nothing — comments and strings satisfy
  it; any workflow-logic criterion is verified by executing the behavior (extract-and-run
  the pure function, or a smoke harness), never by grep-of-presence. (Exit-code
  hygiene: never `cmd | tail; echo $?` — pipe status masks the build's code. Include the
  repo's lint check scoped to the packet's files when one exists. A packet editing a file
  that already has tests runs ALL of that file's existing test classes in Verify — find
  them with `git grep -l <ClassUnderTest>` — not only the newly named ones.) Four proofs
  of can-it-fail: a property/soundness test asserts its own non-vacuity (fail if the count
  of cases exercising the property is zero); a code path that can fall back to a live
  global binary gets a deterministic override plus a hermeticity canary (nonsense input,
  known output); a "pre-existing failure" claim is verified only in a fully-installed real
  checkout, never a symlinked or freshly-isolated worktree; and a probe or spec file is
  proven to be inside the checker's own file set before its green result counts — a
  tsconfig `files` array is not filtered by `exclude`, so a probe can typecheck vacuously.
- Is the Verify blind to reachability, or to what a person actually sees? Unit + type + lint
  runs go green for a page that never becomes a route (an underscore-prefixed segment is a
  private folder, not a URL) and for a badge that renders dark-on-dark or as a raw id. A
  packet adding a page or route asserts it in the build's route manifest or hits it; a packet
  rendering a badge, status, or identity cell asserts the rendered text, not component
  presence. UI and DOM packets also enumerate every terminal path — success, error, cancel,
  degraded/offline — as named acceptance criteria, each one walked in verification; every UI
  inspection FAIL in one dish traced to exactly the terminal path its packet never named.
- Is every literal the packet hands the Cook to copy verbatim — a JSON/YAML config, a CLI
  invocation, an API payload, a command template — validated against the REAL tool before
  dispatch (in a scratch dir when the target doesn't exist yet), with that same tool invoked
  in the Verify block? A string-match or `json.load` proxy waves through literals the real
  tool rejects, and the Cook ships the defect faithfully.
- If this packet authors a command, template, or generator that itself emits work packets,
  does it name the mandatory packet sections (Preconditions & hazards, Verify, falsification)
  as its own acceptance criteria? A meta-packet inherits the schema checklist of what it
  produces.
- Is every stated premise verified against source, not memory: cited precedent tests read at
  line level (what calls they actually make), library/third-party contracts read from the
  actual sources, lookup/query behavior quoted from the query builder, external-API claims
  tagged with a primary source? Dry-run every self-check/grep gate on the base branch —
  confirm it fails for the right reason and cannot force a code change just to satisfy the
  grep.
- Is every named hazard paired with a matching acceptance-criterion test? Guidance without a
  test leaves the regression path open.
- Does any step interpolate repo-external or review-subject text into an agent prompt? Then
  the packet enumerates EVERY interpolation site and routes each through the
  untrusted-content delimiter (BEGIN/END markers + data-not-instructions preamble) — a
  sampled site list ships an unguarded hole; proven twice.
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
