---
name: roadmap
description: "Turns a large initiative into a roadmap of epics, features, stories and tasks that lives on disk and projects onto the ticket board: grills the intent, inventories every affected system through read-only scouts, proposes epics, then drills down in confirmed rounds until each leaf is a ready ticket. Use when the user says plan a migration, roadmap this, break this initiative down, drill down the roadmap, resume the roadmap, or hands over work too big for one ticket. Never cooks; a dish starts only when the operator picks a published leaf."
argument-hint: "[slug] [resume|refresh]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap:*) Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap-view:*) Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord:*) Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate:*) Bash(${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config:*)
---

# Roadmap an initiative

A roadmap is the plan above the dish: one initiative (a migration, a platform move, a product
area) broken into a tree of epics, features, stories and tasks, stored as files under
`<roadmap_dir>/<slug>/` and published to the board as top-level tickets. You are the
Planner. You run a conversation in rounds; every change to the tree is a batch the operator
confirms once, written to disk before it is applied.

**This skill never cooks.** No claim, no `worker`, no work packets, no worktrees. A dish
starts later, when the operator picks a published leaf ticket and says go (the `brigade`
skill). Work packets belong to dish time and are built from fresh research then.

Helper scripts live at `${CLAUDE_PLUGIN_ROOT}/scripts/` and are not on PATH. Below,
`brigade-roadmap`, `brigade-roadmap-view`, `brigade-coord`, `brigade-validate` and
`brigade-config` mean `"${CLAUDE_PLUGIN_ROOT}/scripts/<name>"`. `<dir>` means the roadmap
folder, `<roadmap_dir>/<slug>/`.

Load the brigade skill's `SCHEMAS.md` (next to the brigade SKILL.md in this plugin) for the
`roadmap`, `roadmap_node`, `roadmap_batch`, `brief`, `ticket` and `design_swag` types. Read
`.brigade/config.md` for the source transport and status mapping; if it doesn't exist, run
/brigade:onboard first. From the same file's `## Repo` section, read `roadmap_dir` once
(default `.brigade/roadmaps`) and use it for every roadmap path in this session.

Copy this checklist into your first message and check items off as they complete:

- [ ] 0 Lease — slug chosen, `roadmap-<slug>` acquired before the first write
- [ ] 1 Intent — two-hat grill done, `## Original request` verbatim, `## Systems` filled, board swept for existing tickets
- [ ] 2 Inventory — one scout per system question, briefs on disk, inventory rows written, boundary confirmed
- [ ] 3 Epics — proposal, inspector blind sketch, one confirmed batch applied, epic tickets published
- [ ] 4 Order — `bfs` or `dfs` (+ focus) chosen and saved in ROADMAP.md
- [ ] 5 Drill rounds — `next`, ground, draft or mark leaf, inspector pass, `check`, confirm, apply, publish ready leaves; repeat
- [ ] 6 Report — round summary, `roadmap.html` rendered, share offered, lease released

Resuming a roadmap skips straight to § Resume; a `refresh` runs § Roll-up only.

## Arguments

- `[slug]` — the roadmap's folder name: lowercase kebab-case, named for the initiative
  (`warehouse-migration`), never for the process. Absent: list `<roadmap_dir>/*/` and ask
  which one, or ask for a new slug.
- `resume` — continue an existing roadmap (§ Resume). Also the default when `<dir>/ROADMAP.md`
  already exists and no mode word was given.
- `refresh` — bring an existing roadmap up to date with the board without drilling (§ Roll-up),
  then report.

## Lease

One lease guards the whole roadmap folder and every ticket it publishes:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" acquire roadmap-<slug> claude
```

- Acquire before the first write of the session (creating `<dir>`, a brief, a node, a batch,
  a ticket) and keep the returned `owner` token.
- Heartbeat with `brigade-coord heartbeat roadmap-<slug> <owner-token>` after every scout or
  inspector wave.
- Release with `brigade-coord release roadmap-<slug> <owner-token>` **before every
  confirmation stop** — every question to the operator that waits for an answer, every batch
  shown for approval, the final report. Reacquire before the next write.
- A lease held by another runtime or session leaves the roadmap read-only: show who holds it
  and its last heartbeat, and let the operator decide. Never break it without their explicit
  approval (`COORDINATION.md` in the brigade skill).
- A ticket already claimed by a dish (its own lease, or status past `todo`) is never mutated
  from a roadmap session; record it in the round report instead.

## Batches

Every change to nodes or the board goes through a batch file, `<dir>/batches/<n>.md`
(`doc: roadmap_batch`, `<n>` one past the highest existing number). The order is fixed:

1. **Write it `state: proposed`** before you show it: the ordered `operations`
   (`create_node`, `update_node`, `publish`, `link`, `status`), an empty `receipts` list,
   `## Proposal` (what changes and why), `## Dispositions` (each inspector finding with your
   ruling: folded in, rejected with reason, or deferred as an open question).
2. Release the lease, show the batch, get **one confirmation for the whole batch**. Edits the
   operator asks for go into the same file, still `proposed`, and are shown again.
3. On yes: reacquire, record the operator's answer under `## Dispositions`, set
   `state: approved`.
4. Apply operations in order. After each one, read it back (re-read the node file; re-read the
   ticket from the source) and only then append its receipt
   (`{ target, ticket, read_back: ok }`). A failed read-back stops the batch: leave it
   `approved`, report the failing operation, do not continue.
5. When every operation has a receipt: set `state: applied`, append one log line to
   ROADMAP.md `## Batches` (`<n> — applied — <one-line gist>`), bump `next_ids` for every id
   the batch used, and run `brigade-validate <dir>`.

Ids (`E-001`, `F-001`, `S-001`, `T-001`) come from `next_ids` in ROADMAP.md, are reserved when
the batch is written, and are never reused, even when a proposed batch is abandoned.

**Publishing a ticket** is the one operation that can double up after a crash. Before creating
a ticket, search the board for one whose `roadmap` and `node` keys (or first `## Context` line)
already name this node; if one exists, record it as the receipt instead of creating a second.
After creating, write the ticket id into the node's `ticket` and the ticket's status into
`status`.

## 1. Intent

Create `<dir>` with ROADMAP.md (`doc: roadmap`, every body section present, `mode: bfs`,
`focus: ""`, `max_depth: 4` until § 4 sets them). Then:

- **Grill in two hats, one question at a time** — the brigade skill's Phase 0 grill. Product
  hat first: who the initiative is for, what done looks like, what is out of scope, which
  deadlines and freezes bind. Architect hat second: which systems are touched, what must keep
  working during the move, how each outcome is mechanically verified, what data must never
  leave its system. Use the `grilling` skill for interview discipline if installed. Never
  answer for the operator; a question they can't answer yet becomes a named open question.
- **Original request** — paste the operator's words verbatim into `## Original request`. Never
  rewrite them.
- **Intent and requirements** — `## Intent` is the outcome in a short paragraph; each
  commitment the grill produced is a `## Requirements` row (`R-001`…, kind
  `functional|inventory|parity|risk|constraint`, status `proposed`; the operator accepts or
  drops each at the epics confirmation).
- **Systems table** — one `## Systems` row per system the initiative reads or changes: id
  (`SYS-1`…), kind (repo, database, warehouse, object storage, service, scheduler…), locator
  (a repo path, a host alias, a bucket name — never a credential), the **read-only** command a
  scout may run against it (`git ls-files`, a catalog listing, a bucket listing, a describe
  call), and `access`: `ok` when you have seen that command succeed in this session, else
  `missing`. A system with `missing` access becomes a `task` open question naming what the
  operator must grant; it gets no scout until it reads `ok`.
- **Existing-ticket sweep** — list the operator's open tickets and any ticket mentioning the
  initiative. For each overlap record one decision under `## Decisions`: absorb (a later
  publish links the node to that ticket instead of creating one), cross-reference, or leave.
  Never create a ticket for work the board already holds.

**Complete when:** ROADMAP.md validates, the original request is verbatim, every system has a
read-only command and an access value, and every overlap has a decision.

## 2. Inventory

Inventory answers "what exists today that this initiative touches": tables, jobs, services,
buckets, endpoints, dashboards, consumers. Each discovered thing becomes one `## Inventory` row
(`I-001`… | system | thing | evidence | covered by | excluded by).

- Formulate **one question per system** (split a system with several unrelated questions into
  several questions). Each question names its system id and pastes that system's read-only
  command from `## Systems`.
- Invoke the research workflow by name, `name: "brigade:brigade-research"`, with
  `dishDir` = `<dir>` so briefs land in `<dir>/briefs/`, plus `repoRoot`, `now`, `tier`,
  `questions`, `overrides`, `promptOverrides` and `writing` resolved as in the brigade skill's
  `CONFIG.md`. Paste the `brief` schema into each question.
- Every question carries these rules, verbatim: **read-only commands only — nothing that
  writes, deletes, moves, restarts or grants; evidence is the literal command and its
  sanitized output; mask secrets, tokens, account ids, hostnames that are not already in the
  Systems table, and personal data; never paste customer rows, only schemas, names and
  counts.** A brief that breaks them is discarded and its question re-asked once.
- Read the briefs, write the inventory rows with each brief's path as `evidence`, and record
  anything a scout could not reach as a `task` or `research` open question.
- **Boundary confirmation**: release the lease, show the inventory grouped by system with the
  rows you propose to exclude (each with a one-line reason), and ask the operator to confirm
  the boundary. Excluded rows get a `## Decisions` line and that decision's name in
  `excluded by`; a row nobody covers and nobody excludes fails `check --complete` later.

**Complete when:** every system with `access: ok` has a brief, every row cites one, and the
operator confirmed the boundary.

## 3. Epics

- **Proposal (you, the Planner).** Draft epics so that every inventory row not excluded and
  every requirement lands under at least one epic. Each epic: title in the operator's product
  language, `## Goal`, the requirement ids it `satisfies`, the inventory rows it `covers`,
  `depends_on` other epics where order is forced. No features yet.
- **Inspector blind sketch.** Dispatch `brigade-inspector` in plan-check spirit with the
  intent, requirements, inventory and briefs, and this charge: sketch your own epic split
  first, before reading the proposal; then read it and compare coverage (rows or requirements
  no epic owns), overlap (two epics owning one thing), ordering (a dependency the proposal
  missed or a cycle), and size (an epic that is really two initiatives). Output a findings
  list (severity + concrete fix) to `<dir>/findings/epics.md`. Advisory, no PASS/FAIL.
- **One batch.** Fold in the findings you accept and write one batch: `create_node` for every
  epic (`drill: open`) and a `publish` for every epic ticket; its `## Proposal` lists each
  requirement as accepted or dropped. Confirm it once (§ Batches), then apply, writing the
  requirement statuses into ROADMAP.md as part of the apply.

**Publishing an epic or a leaf** uses the source adapter's *create ticket* operation: always a
top-level ticket, never a subtask; planning status `backlog`; first line under `## Context` is
`Roadmap: <slug>/<node-id> | <epic title> > <parent title> | satisfies <R-ids> | blocked by
<ticket ids>`; markdown boards also get the frontmatter keys `roadmap`, `node`, `epic`,
`parent_ticket`, `blocked_by` and `satisfies` (`sources/TEMPLATE.md` in the brigade skill).
Ticket bodies are for humans: plain language, no local paths, no brigade jargon, no secrets.

## 4. Order

Ask the operator how to drill:

- `bfs` — breadth first: every epic gets its features before any feature gets stories. Good
  for sizing the whole initiative early.
- `dfs` with a `focus` node id — depth first under one epic or feature until its leaves are
  ready. Good when one slice must start cooking soon.

Write `mode`, `focus` (`""` for bfs) and `max_depth` to ROADMAP.md frontmatter and a
`## Decisions` line. The operator may change either at the start of any round; record each
change the same way. `brigade-roadmap next` always reads the saved values.

## 5. Drill rounds

Each round, in order:

1. **Frontier** — `brigade-roadmap next <dir>` prints up to seven open nodes for the saved
   mode, then the parked ones with the questions that park them. `focus complete: <id>` ends
   a dfs focus: ask for the next focus or a switch to bfs.
2. **Ground** — for each batch node with no brief in its `sources`, ask one scout question
   through `brigade-research` (same rules as § 2). Skip nodes whose briefs already answer
   where the work lands.
3. **Draft** — per node, either split it or mark it a leaf:
   - **Split**: draft its children one level down (epic → feature → story → task), each with
     a `## Goal`, its share of the parent's `satisfies` and `covers`, `depends_on` siblings
     where order is forced, and `drill: open`. The parent gets `drill: split` and a
     `## Children` line per child.
   - **Leaf**: the node is one ticket's worth of work. Give it the ticket body contract
     (`## Goal`, `## Context` with the brief's real paths and anchors, `## Acceptance
     criteria` as observable checkboxes, `## Constraints`, `## Out of scope`), exactly one
     `repo`, `size_swag` `XS`, `S` or `M`, and its brief in `sources`. `drill: leaf`.
4. **Inspector pass** — dispatch `brigade-inspector` with the drafts, their briefs and the
   `roadmap_node` schema, charged as in grooming: is each leaf one outcome, is every criterion
   mechanically checkable, what constraint will bite an executor, could the split leave a
   requirement or inventory row uncovered? Findings to `<dir>/findings/round-<n>.md`.
   Advisory; you rule on each finding in the batch's `## Dispositions`.
5. **Check** — write the batch (`proposed`). Nothing in `<dir>/nodes/` changes yet: copy
   `<dir>` to a temporary directory (`mktemp -d`, outside `.brigade/`), write the drafted
   node files into the copy, and run `brigade-roadmap check <copy>`. Every problem it prints
   is fixed in the draft or turned into an open question before the operator sees the batch.
   Delete the copy afterwards.
6. **Confirm once** — release the lease and show the batch: per node, split or leaf, the
   children or the leaf's goal and criteria, the dispositions, and new open questions.
7. **Apply** — on yes, apply per § Batches, then `brigade-roadmap check <dir>` again; a
   failure here is reported, never papered over.
8. **Publish ready leaves** — leaves that pass `check` and have no ticket go into a
   publish batch (it may be the same batch, as trailing `publish` operations), confirmed and
   applied the same way. Publish in dependency order: prerequisites first. A leaf whose
   `depends_on` names a node that has no ticket yet waits for that node's batch. A leaf whose
   `depends_on` names a published node carries that node's ticket id in `blocked_by`. A split
   prerequisite counts as published once every leaf under it is, whatever its own ticket says,
   and the dependent carries all of those leaves' ticket ids in `blocked_by` instead.
   **Linking pass** — after every publish batch run
   `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap" links <dir> --board <board_dir>` on a
   markdown board. Each `missing_blocked_by` line is a missing `blocked_by` edit (a `pending`
   line is a split prerequisite with leaves still unpublished); propose those edits in
   the same confirmed batch and re-run the check after apply. A non-markdown board keeps the
   blockers in the Context marker line instead, and the re-run reads the tickets back.

Repeat rounds while the operator wants to continue. One round, one confirmation.

### Stopping rules

- **Leaf readiness** — a node is a leaf only when `check` would pass it: a `## Goal`, at least
  one acceptance checkbox, exactly one repo, `satisfies` or `covers` non-empty, size `XS|S|M`,
  no open question on it or an ancestor, and at least one brief. An `L` or `XL` node splits
  again; it is never published as a leaf.
- **Max depth parks** — a node at `max_depth` that still is not a ready leaf is set
  `drill: parked`, and an open question names it and says what would let it become a leaf.
  It returns to the frontier only when that question is resolved (moved to `## Decisions`)
  and the node is set back to `drill: open`.
- **Open questions park too** — a question whose text names a node id parks that node and its
  whole subtree. Phrase it decision-ready, in the `design_swag` line format, named never
  numbered: `- **<name>** — \`research|grilling|prototype|task\` · AFK|HITL — <node id>: <the
  question>. Blocked by: <name>|none`. Resolve `research` questions with a scout wave and
  `grilling` ones by asking the operator, one at a time; record each answer as a decision line.
- **No work packets** — a leaf is a ticket, not a packet. File lists, wave plans and verify
  commands are built at dish time from fresh research; never write them into a node.
- **Stop when asked or when done** — the roadmap is complete only when
  `brigade-roadmap check --complete <dir>` exits 0 (parked branches count as incomplete):
  no open branches, every inventory row
  covered or excluded, every accepted requirement satisfied by a leaf, every ready leaf
  published.

## Resume

Resume is mechanical. Never re-grill, re-inventory or re-confirm what a batch already applied.

1. Acquire the lease (read-only if another holder has it).
2. `brigade-validate <dir>` and `brigade-roadmap check <dir>`; read ROADMAP.md frontmatter,
   `## Open questions` and `## Batches`, not every node.
3. **Replay before anything else**: any `batches/<n>.md` with `state: approved` was confirmed
   but not finished. For each operation in order: one with a receipt is read back again and
   skipped if it holds; one without a receipt is applied (publish checks for an existing
   ticket first, per § Batches). Then mark it `applied`. A `proposed` batch was never
   confirmed: show it again or discard it with the operator; never apply it unconfirmed.
4. The frontier comes from disk: `brigade-roadmap next <dir>`. Tell the operator in two lines
   where the roadmap stands (nodes, leaves ready and published, parked, questions by name),
   then continue at the first unchecked checklist step.

## Roll-up

Bring node status in from the board, read-only on the board side:

- Markdown boards: `brigade-roadmap sync <dir> --board <board_dir>` copies each published
  ticket's status into its node. Other sources: read each published ticket's status through
  the adapter and write it into the node through an `update_node` batch.
- `brigade-roadmap status <dir>` prints each epic's derived status and which requirements are
  met (every satisfying leaf done). Parent status and "met" are derived; never write them.
- A `refresh` run is: lease, roll-up, view, report, release. No drilling.

## 6. Report and view

End every session and every round the operator stops on with:

- nodes drilled this round, leaves ready, leaves published (ticket ids), parked nodes;
- open questions **by name**, with the node each one parks;
- coverage gaps from `brigade-roadmap check --complete <dir>` (uncovered rows, unsatisfied
  requirements, unpublished ready leaves), systems still at `access: missing`;
- which published leaves you would cook first and why, as a suggestion only;
- the path to the view: `brigade-roadmap-view <dir>` writes `<dir>/roadmap.html`, one offline
  page with Outline, Dependencies, Boards and Coverage.

Offer to publish the page as a shareable artifact (for example an artifact the session can
publish, or an attachment on the initiative's epic ticket). Publish only on a yes, and only
after checking the page holds no secrets, hostnames or personal data beyond what the board
already shows. The file itself stays under `.brigade/` and is never committed.

Release the lease. A roadmap session is complete when the report is delivered and the lease
is released. It never proceeds into a dish on its own: cooking starts only when the operator
names a published leaf ticket and says go.

## Guardrails

- The original request is preserved verbatim; ticket bodies are never overwritten without a
  confirmed batch.
- Scouts and inspectors report; only you write nodes, batches and tickets.
- Read-only everywhere outside `<dir>` and the board: no scout or command changes a system it
  inventories, and a command's output with secrets or customer rows never reaches disk.
- Open questions are surfaced and named, never answered by invention.
- Nothing under `.brigade/` is committed.
