# Decompose — Phase 2

Read when: writing or revising PLAN.md, before the plan check, and whenever a retro or plan
check cites a rule id.

## Contents

- Write the plan
- P — Verify every premise before it goes in a packet
- D — Shape the DAG
- The haiku bar
- Heavy flags
- Research dishes
- Adversarial plan check
- The planning checkpoint
- Complete when

Rules are numbered so a retro, plan check, or analyst report cites `P3`/`D5`, not prose; each
ends with the evidence that earned it, which stops a plausible exception talking it away.

## Write the plan

Write `.brigade/dishes/<dish-slug>/PLAN.md` to the `plan` type in `SCHEMAS.md`: frontmatter
carries the ticket, intake decisions, and the machine-readable item list (slug, status,
depends_on, heavy, files); the body carries a `templates/work-packet.md` packet per item. A
groomed ticket's `## Proposed breakdown` is a **hint, not a contract**: check each piece
against the scout briefs and the rules below, keep what holds, split or merge what doesn't,
and note material deviations in `PLAN.md` so the ticket author can see why the shape changed.

## P — Verify every premise before it goes in a packet

Any contract a packet states as fact is read at source level before dispatch. An unanchored
scout claim is an inference to re-derive, not a fact to paste.

- **P1 — Source-level reads.** Quote the real library signature, the precedent's real calls,
  the query builder's WHERE/label clause, or the primary doc, never one you only read *about*.
- **P2 — Dry-run every gate, and classify what it proves.** Run each distinct gate command
  and self-check grep on the base branch before dispatch, then classify them, because a green
  exit says nothing about scope on its own:
  ```bash
  "${CLAUDE_PLUGIN_ROOT}/scripts/brigade-evidence" classify --json <gate-cmd>...
  ```
  A `targeted` result proves one file or one package, not the repo, and a suite narrowed by
  `--filter`, `--project`, `-k`, or a path argument exits 0 exactly like the full suite, so
  record each gate's `scope` in the Verify block for the cook, the inspector, and Phase 6.
- **P3 — Exhaustiveness claims are re-derived.** "All call sites" comes from your own grep at
  packet-write time, never from a brief or review — every copied list so far has been short.
- **P4 — Parity claims are checked against base.** Verify "matches today's behavior" against
  the base branch itself; sibling artifacts written alongside the change (docs, tests,
  comments) validate each other circularly and prove nothing.
- **P5 — Coverage claims carry proof.** "Existing tests already cover X" cites the covering
  test's name and line, or the grep output that proves it — two sibling packets in one dish
  repeated the same unverified coverage claim that a one-line grep disproved.
- **P6 — Propagation claims are read off the resolver.** "Existing records pick this up
  automatically" — data denormalized at write time never retro-updates; when it doesn't
  propagate, the item carries the backfill or seed-migration step rather than a hope.
- **P7 — Grep for the existing receiver before adding a new one.** Before proposing a new
  listener, sync, trigger, or handler class, find what already receives that event and read
  its doc comment; if you still want one, the item note cites the existing handler as extended
  or bypassed, and why. An uncited new mechanism is an unfinished plan — one Planner drafted
  four duplicate mechanisms across two dishes on one branch, every one caught downstream.

## D — Shape the DAG

- **D1 — Disjointness is the spine.** Two items in one wave must not touch the same files,
  docs included; genuine overlap gets a dependency edge, not parallel dispatch. A later merge
  conflict means the decomposition was wrong: note it in `LEARNINGS.md`, sequence next time.
- **D2 — A rewrite invalidates a verdict.** Any rewrite of a file that already carries an
  inspector PASS needs a re-verdict covering the new content before merge.
- **D3 — Shared contracts own their blast radius.** An item that edits a shared type, schema,
  or interface names every consumer that must compile against it in its scope, and goes first
  in the DAG so dependents branch from the merged contract.
- **D4 — Ownership runs the whole call chain.** An item adding a leaf API, callback, or flag
  names each hop the real consumer walks (leaf → panel → section → host; producer → resolver →
  policy) and verifies at the consumer end, not the producer — "the mechanism exists" is not
  "callers traverse it", so a scout question covers invocation topology (who mounts this, how
  the tests mount it) whenever behavior routes through a central handler, middleware, or DI.
- **D5 — The producing item creates the shared facade.** A shared facade or re-export that
  ≥ 2 sibling items import is in the producing item's own files list, never left for the
  first downstream cook to discover missing.
- **D6 — Cross-dish shared artifacts get a tracked bridge.** When another in-flight dish also
  compiles against a shared artifact, widen it behind a temporary backward-compatible
  overload so their branches keep building, and record removing that scaffolding as an
  explicit cleanup item in PLAN.md — an untracked bridge becomes permanent API.
- **D7 — A wave-boundary gate is pasted into a packet.** A gate the plan schedules at a wave
  boundary goes verbatim into the Verify block of the packet that closes that wave; a gate
  that lives only in plan prose is a gate nobody runs — a promised post-wave production build
  never ran, and a blocking prerender regression survived every per-item gate.

## The haiku bar

Whatever model cooks it, a first-attempt packet clears all of this or is **split further**:

- Touches **1–3 named files** (plus its own new test file).
- **≤ ~150 changed lines** expected.
- **One behavior** — describable in one sentence without "and".
- **Zero exploration required** — every contract, snippet, and convention the Cook needs is
  *in the packet*; a hedge like "look around for…" means unfinished research or splitting.
- **Mechanically verifiable** — the packet names the exact command(s) that prove it done, and
  count-style checks assert the **delta against base** (new occurrences, changed lines),
  never an absolute count of a term the base file already contains.

## Heavy flags

An item that is irreducible and still hard is marked `heavy: true` in the plan and dispatches
to the heavy Cook from the start, at any tier. Hard means one of:

- Cross-cutting, concurrency, security, data correctness, or subtle contracts.
- **A proven cheap-model failure class:** comparisons across two serialization/hash domains;
  soundness or under-approximation proofs; verbatim external signatures or citations; literal
  placeholder text; byte-faithful extraction or mirroring; exact alignment.
- **A named-but-self-enforced hazard** — a packet that names a data-structure alignment,
  ordering, or drop-semantics hazard for the cook to hold in mind, with no gate enforcing it
  mechanically; cheap cooks went 0/4 across this class and same-model retries fixed nothing.
- **An exact-message assertion** — a test packet asserting an exact error or output string;
  haiku fabricates or case-swaps it rather than report the mismatch; a prose ban has not held.
- Verbatim insertion at an exact quoted anchor is **not** hard — cheap cooks paste at anchors
  cleanly (first-attempt clean where reformatting went 0/4), so leave those `heavy: false`.

**Mechanical risk check.** At packet-write time run
`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-risk" --json --files <item's files>` over every item's
files list; the table lives in `policies/risk-escalation.md`. An `escalate: true` result
forces `heavy: true` in the item's frontmatter entry **as a plain value** — never an inline
`#` comment in the flow mapping, or `brigade-validate`'s manual parser breaks — and records
the matching categories in the packet header line (`**heavy:** true — table: auth`).

Table flags are add-only: judgment may add heavy flags, never remove one the table set. Over
~1 in 5 heavy (judgment flags only; table flags exempt) means the decomposition is too coarse.

## Research dishes

Give every item a research depth at plan time; it picks the researcher's model and report
budget regardless of tier: `light` (haiku, ≤ 150 lines, repo-first), `medium` (sonnet,
≤ 250 lines, one candidate/area with web sourcing), `heavy` (opus, ≤ 400 lines,
decision-grade surveys and rubric scoring). Dispatch in waves like cooks (≤ 4 at a
time; a rubric-producing item goes in a wave before the siblings that score against it)
and write the synthesis yourself. Two rules:

- A build-vs-buy or tool-choice rubric carries a weighted **governance/longevity** criterion
  (maintenance activity, bus factor, single-vendor rot risk) alongside the technical-fit
  axes, or a well-executed custom build scores as a ceiling the rubric can't discount.
- Convergence between researchers is independent validation only when the reports did not
  share the inputs that explain it — same rubric, grounding briefs, or source docs; say what
  they shared and call material overlap "consistent with shared grounding", not confirmation.

## Adversarial plan check

Policy is set by the tier (`TIERS.md`: ★★★ always; ★★ when the dish has ≥ 6 items, touches a
shared contract, or burned you last time; ★ never — self-check against the haiku bar). When
it runs, before showing the user the plan, dispatch `brigade-inspector` in **plan check
mode**: blind to your plan, it sketches its own decomposition from the ticket + scout briefs
(to break groupthink), then reads `PLAN.md` and writes a comparison — coverage differences,
which version is stronger at each divergence and why, and concrete merge recommendations.

It **executes** rather than reads the packet's pasted Verify commands and premise-probes
against the real tree — every executing plan check so far caught a defect a reading pass
would have shipped: an invalid-JSON repro payload, a second bug under the stated one, a
hard-FAIL that would brick a complete historical dish, a Verify command dying on shell shims.
Three things the check resolves rather than reports:

- When siblings assert the same runtime string or output, or embed a scout-brief payload, the
  check runs that case **once** and pastes the captured output into each such packet — never
  re-derived or analogized; an analogized deny message burned a full escalation ladder.
- When it raises a blocking contradiction between a sourced scout claim and an assumption
  your plan overrides, and the assumption is cheap to test, the resolution is a **live probe
  run before dispatch** — never an unsourced assertion from either side.
- When another active dish shares this delivery branch, paste that dish's item file lists
  into the plan-check packet with an explicit overlap instruction — a file both plans touch
  is a blocking coordination point, not something commit ordering can be trusted to sort out.

You fold in what's right. You own the plan; the check is information, not instruction. A bad
decomposition costs far more than one sonnet pass, and the tier already priced that trade.

## The planning checkpoint

Show the user the plan (item titles, DAG edges, wave layout, heavy flags, plan check verdict
if any) and get one confirmation before creating branches — the single planning checkpoint.

## Complete when

PLAN.md validates (`brigade-validate`), every packet clears the bar above, the plan check
(when the tier runs one) is folded in, and the operator has confirmed the plan once. Release
the dish lease before yielding for that confirmation. After it, never re-plan or re-confirm:
the next stop is handoff, and `EXECUTE.md` names the only conditions that interrupt it.
