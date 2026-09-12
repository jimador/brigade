# Brigade heuristics (team store)

Generalizable rules learned from dish retros. One entry per rule. Append-only;
retire absorbed rules by marking `status: absorbed` (do not delete evidence).

## Format

```markdown
### YYYY-MM-DD <short title>
- status: active | absorbed
- rule: <one sentence>
- evidence: <what happened>
- source: <dish slug or analyst path>
```

## Entries

### 2026-09-12 Execute counting Verify lines at plan time

- status: active
- rule: Run every packet Verify line that asserts an exact count against the base commit while
  planning, and record the base number beside it; an unexecuted count assertion blocks plan
  approval.
- evidence: Two items implemented their packets correctly and then BLOCKED on arithmetic in
  their own Verify block — one asserted three removed lines where git reports two (the unchanged
  middle line of a three-line replacement stays as context), the other counted deletions with
  `grep -c '^-[^-]'`, which cannot match a removed line whose own text starts with `-`, reading
  6 for 8. The plan check that executed packets in a scratch copy caught a third unreachable
  count before any dispatch.
- source: local-skills-best-practices

### 2026-09-12 One threshold for report evidence

- status: active
- rule: A cook report's Evidence section pastes each Verify line's literal command text and its
  real output or exit status; paraphrased or self-labeled "CHECK n OK" tokens are a blocking
  finding, not a low one.
- evidence: One item FAILed review for a fabricated Evidence section while two others passed the
  identical defect as medium in the same wave — the same class drew two thresholds, which is how
  a gate stops meaning anything.
- source: local-skills-best-practices

### 2026-09-12 Ledger where state is expensive, not by default

- status: active
- rule: Give a working-memory ledger to rework attempts and to items whose state is expensive to
  rebuild, rather than to every heavy item by default.
- evidence: Across nine matched pairs the ledger showed no outcome separation (first-attempt
  PASS 9/9 with vs 8/9 without; findings excluding ledger upkeep 14 vs 14) and cost 29% more
  first-attempt cook context, twice the upkeep findings, and one ledger that blew its budget and
  needed compaction after landing. Confounded by difficulty-correlated assignment and a mid-dish
  cook-model change; indicative, not proof.
- source: local-skills-best-practices (docs/experiments.md E-001)

### 2026-09-12 Never dictate a literal attribution trailer

- status: active
- rule: A packet's Conventions name the session's mandated attribution trailer; they never quote
  a literal `Co-Authored-By: <model name>`.
- evidence: A dish whose packets quoted one model name drew a finding on roughly a fifth of its
  items, every cook correctly preferring its own session's instruction, and cost a
  normalize-every-commit pass at handoff.
- source: local-skills-best-practices

### 2026-09-12 Budget turns in an over-ceiling packet

- status: active
- rule: When a packet exceeds the granularity ceiling, say in it that the commit and the report
  come before any polish and that the cook returns as soon as the report is on disk.
- evidence: The one cook to exhaust its 80-turn cap ran the largest packet in the dish and spent
  its last calls tidying a report it never returned, which aborted the whole run; with a
  turn-budget note added, every later cook returned in 15–59 calls.
- source: local-skills-best-practices
