# Upgrading open work after a plugin update

Read when: `brigade-onboard status --json` reports `work_drift: true`, SessionStart says open
work predates the plugin, or the operator says "upgrade my open work", "upgrade the tickets"
or `/brigade:upgrade`.

A plugin update changes the rules, not the artifacts already on disk. Config drift heals
itself at SessionStart; this pass brings **open work** up to the installed rules: board
tickets that are not done, and dishes under `.brigade/dishes/` that have not handed off. It
edits artifacts only. It never claims a ticket, changes a ticket's status or assignee,
dispatches, cooks, lands, or hands off.

## The pass

1. **Read the gap.** From `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard" status --json`,
   take `work_version` (null means never upgraded) and `work_upgrades_pending` (the ledger
   versions above it that touch work). Read those entries below, oldest first.
2. **Inventory open work.** Run the source adapter's "list my tickets" op once
   (`skills/brigade/sources/<source>.md`) and keep every ticket whose status is not `done`.
   List `.brigade/dishes/*/PLAN.md` and keep every dish with an item that is not `done`, or
   with no `reports/acceptance-verdict.md` yet. Run
   `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate" .brigade/dishes/<dish>/PLAN.md` on each
   open dish.
3. **Plan.** For each pending entry, run its `find` against the inventory; every match is one
   row: artifact, entry version, the change. Add one row per `brigade-validate` error. An
   entry whose `find` matches nothing adds no row. Respect the item's state:
   - `todo` or `rework` items: the packet MAY be rewritten to the entry's change.
   - `dispatched` or `in_review` items: a cook or inspector is reading the packet. Change
     frontmatter only, and list the packet change as a row for after the item settles.
   - `done` items, done tickets and handed-off dishes: never touched.
4. **Confirm once.** Show the table and get one yes from the operator. With no rows, say
   so, skip to step 6, and ask nothing.
5. **Apply.** Edit dish files directly. Edit tickets only through the source adapter's
   update op, and append one Activity comment per changed ticket naming the version
   (`[planner] Upgraded to brigade <version>: <change>`).
6. **Verify and record.** Re-run `brigade-validate` on every touched dish and re-read every
   touched ticket. Then run `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard" work-record`,
   which writes `.brigade/upgrade.json` with the installed version, so `work_drift` clears.
   Report a table: artifact, change, done / deferred / failed. Never record after a failed
   row; fix it or report it and stop.

Every `find` is a content check, never a version check, so a second pass over the same work
finds nothing and changes nothing.

## Ledger

Newest first. One entry per plugin version that changes what open work should contain or
how it is run. `touches` is `none`, `tickets`, `dishes` or `tickets, dishes`; the status
script reads it, so keep the line exact. An entry with `touches: none` changes procedure
only: open work picks it up at its next phase and the pass records it without edits.

### 0.51.0

- touches: none
- what: a dish can come back from PR review. Ticket statuses gain `rework` (a reviewer sent the
  PR back; a board without it uses `in_progress`) and an optional `merging` (the planner lands an
  approved PR). `HANDOFF.md` § 8 sweeps PR comments into a ruled `## PR feedback` table and replies
  on each thread before any change; § 9 lands an approved PR. PLAN.md may carry
  `### Ticket test plan` (`TP<k>` lines, each owned by a packet), `## PR feedback` and
  `## Follow-ups`; `brigade-validate` checks them and takes `--ticket <file>`. Cook reports may
  carry a capped `## Confusions` section the analyst reads. `brigade-status` lists stale
  worktrees. `brigade-config` reads `tier` and `verification_gate` from `.brigade/config.md` as
  a layer under the JSON layers. `brigade-scope` lets a contract item change paths other
  contract items list. `brigade-config prompts --json` now carries the override text, and the
  workflows apply it; before this, overrides passed as the docs said were dropped silently.
  The redesign from a 455-dish field audit: a PASS without a verdict file is recovered
  from the inspector's own returned text, else one fresh inspector; workflows reject malformed args at entry; a cook whose commit is refused reports
  `committed: false` and the steward commits its staged files; `brigade-rehearse` runs the
  pipeline's checks over a plan and the plan check uses it; D13 makes a 3+ item chain on one
  file one slice; the validator warns on oversized items, placeholder model names and red runs
  with no named mutation; the verdict schema has one source in `scripts/lib/schemas.mjs`;
  `brigade-coord` gains path leases and `hot-files`; TIERS.md and doctor recommend two-star;
  `parsePlan` no longer hangs on some plans. The D13 warnings skip landed items and files git
  marks `linguist-generated`; the repo's `.gitattributes` marks the generated workflow bundles. Existing plans and reports validate unchanged.
- config: `.brigade/config.md` without a `- rework:` line maps `rework` to itself and falls back
  to `in_progress`; SessionStart config drift adds the line from the template.

### 0.50.0

- touches: none
- what: planning goes one level at a time and slices contract-first. PLAN.md frontmatter may
  carry `level`; items may carry `contract`; attempts may carry `cause`, `reason` and the
  `answer-retry` trigger; PLAN.md may carry a `## Parked` section. New plan fields are
  optional and validation of existing plans is unchanged (new contract-first rules apply only
  to plans that use the new fields). New helpers: `brigade-scope` checks an item's diff
  against its files and contract-owned paths, `brigade-plan-view` renders PLAN.md as one HTML
  page, and `brigade-risk` flags `design_review` paths. A PostToolUse hook warns running
  subagents before `maxTurns` (`budgets` config key). Every verdict now needs a fresh
  sonnet-or-stronger reviewer, and contract tests are read-only for cooks.

### 0.49.0

- touches: none
- what: a plan check lists its finding ids in `findings:`, and PLAN.md carries a
  `## Plan-check dispositions` table ruling on each one (`fixed`, `pinned` by a named test, or
  `accepted` with a reason) plus each scout brief `## Risks` bullet. `brigade-validate` fails
  the plan while a plan-check id has no row, and warns for a missing Risks row. Plan checks
  written before the key carry no ids, so open dishes keep validating.

### 0.48.0

- touches: none
- what: the SubagentStop hook now also blocks when an agent stops without writing the file
  its dispatch prompt named, and it validates research reports. `brigade-validate` accepts a
  dish directory or any folder of markdown. Scouts run on sonnet with 40 turns and write a
  skeleton brief early, so a scout that runs short still leaves a file behind.

### 0.47.0

- touches: none
- what: handoff gains a red team and a checked PR body. After the acceptance pass the
  Planner runs a find pass and a verify pass over the whole delivery range, each in its own
  process and in a tool other than the author's, fixes what survives with a failing-first
  test, and reviews each new head again. Each round is recorded as a `red_team` artifact.
  The PR body is rendered from `prTemplate` and checked by `brigade-pr check`; a PR leaves
  draft only with a clean verdict on its head or a human override. Both are configured in
  the new `review.redTeam` and `prTemplate` blocks. Open dishes pick this up at their
  handoff; nothing on disk changes.

### 0.46.0

- touches: none
- what: prompt cleanup, no artifact shape changes. The heavy cook now carries the full
  shared cook contract instead of pointing at a file it never sees, and a regression check
  keeps the two copies identical. The scout's last brief section is `## Not verified`, as
  the schema already said. The `/brigade:status`, `/brigade:config` and `/brigade:validate`
  summaries lose their line caps. Smaller fixes: a dead groom path in `SCHEMAS.md`, the
  Designer's model in the roles table, workspace boards described relative to the vault,
  and dated incident notes in the cook's hard rules restated as reasons.

### 0.45.0

- touches: none
- what: three landed changes, none of which edits open work. The steward refuses to land
  an item branch with no commits unless its worktree is clean, and never writes its own
  verdict (#22). The steward is pinned to a mid-tier model unless a config layer swaps in
  its own agent (#23). `models.cookRetry` names the agent for the retry rung of the cook
  ladder, defaulting to the resolved `cook` agent, so existing configs behave as before
  (#24).

### 0.44.1

- touches: none
- what: a cook asked for tests by a packet that numbers no contract clauses writes the
  contract first, as clauses at the top of the test file, then one test per clause
  (`agents/brigade-cook.md` step 3). Cook behavior only; open packets need no edit.

### 0.44.0

- touches: dishes
- what: packets state guarantees a hasty test misses as numbered clauses with their input
  domain, one test per clause, and heavy or data-correctness items falsify each `E`, `I`
  and `L` clause in their Verify (`templates/work-packet.md`, Guarantee clauses). A red full
  gate at handoff is bisected over the landed range (`HANDOFF.md` § 1); that part needs no
  edit, since the rule maps commits through `landedRange` or the landing commit's item slug.
- find: an open dish item with status `todo` or `rework` whose packet contract promises
  ordering, stability, a pure query, idempotence, a round-trip, an exact boundary or inputs
  left unchanged, and has no clause ids (`R1`, `E1`, `I1`, `L1`) in its Contracts section.
- change: rewrite that packet's guarantees as numbered clauses with their input domain,
  name one test per clause in its Implement step, and, when the item is `heavy: true` or
  data-correctness, add the per-clause falsification to its Verify. Leave its files list,
  goal and other steps as they are.
