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
