---
title: Roadmaps
description: Break an initiative too big for one ticket into epics, features, stories and tasks, then publish the ready leaves to your board as tickets.
---

A roadmap turns one large initiative (a migration, a platform move, a new product area) into a tree of epics, features, stories and tasks that lives on disk and projects onto your board. This page covers when to reach for one, how a roadmap session runs, what it writes, and the commands that check and render it.

For a guided tour of a finished example, see the [Skyhop roadmap demo](roadmap-demo.md).

## When to use a roadmap

| You have | Use |
|----------|-----|
| One ticket you want built | a [dish](usage.md) |
| A messy board of existing tickets | [grooming](grooming.md) |
| An initiative that spans several systems and needs many tickets that don't exist yet | a roadmap |

Start one with any of these:

- `/brigade:roadmap <slug>`
- `plan a migration`, `roadmap this`, `break this initiative down`
- `drill down the roadmap`, `resume the roadmap`

The slug is the roadmap's folder name: lowercase kebab-case, named for the initiative (`warehouse-migration`), never for the process.

A roadmap session never cooks. It does not claim tickets, set `worker`, write work packets or dispatch cooks. Cooking starts later, when you pick a published leaf ticket and say go.

## Run a roadmap session

```text
/brigade:roadmap [slug] [resume|refresh]
```

- No slug: Brigade lists the roadmaps under `roadmap_dir` and asks which one, or asks for a new slug.
- No `ROADMAP.md` yet: the session starts at the intent step.
- `ROADMAP.md` exists, or you pass `resume`: the session resumes from disk.
- `refresh`: the session pulls ticket statuses in from the board, renders the view and reports. No drilling.

The Planner runs the session as a conversation in rounds. Every change to the tree is a batch you confirm once, written to disk before it is applied.

### 1. Grill the intent

The Planner asks one question at a time, in two hats:

- **Product hat:** who the initiative is for, what done looks like, what is out of scope, which deadlines and freezes bind.
- **Architect hat:** which systems are touched, what must keep working during the move, how each outcome is verified mechanically, what data must never leave its system.

It never answers for you. A question you can't answer yet becomes a named open question. Your original words go into `## Original request` verbatim, and each commitment the grill produces becomes a requirement row (`R-1`, `R-2`, ...) of kind `functional`, `inventory`, `parity`, `risk` or `constraint`. You accept or drop each requirement when you confirm the epics.

The Planner also sweeps your board for open tickets that overlap the initiative and records one decision per overlap: absorb it, cross-reference it, or leave it. It never creates a ticket for work the board already holds.

### 2. List the systems

Every system the initiative reads or changes gets a row in `## Systems`:

| Column | What goes there |
|--------|-----------------|
| `id` | `SYS-1`, `SYS-2`, ... |
| `kind` | repo, database, warehouse, object storage, message stream, service, scheduler, vendor API, anything |
| `locator` | a repo path, a host alias, a bucket name; never a credential |
| `command` | the read-only command a scout may run against it, such as `git ls-files`, a catalog listing, a bucket listing, a describe call |
| `access` | `ok` once the Planner has seen that command succeed this session, otherwise `missing` |

Any kind of system works. A system at `access: missing` becomes a `task` open question naming what you need to grant, and it gets no scout until it reads `ok`. Missing access parks only that system's part of the plan; everything else keeps moving.

### 3. Take the inventory

The inventory answers "what exists today that this initiative touches": tables, jobs, services, buckets, endpoints, dashboards, consumers. The Planner sends one scout question per system through the research workflow, and the briefs land in the roadmap's `briefs/` folder.

Every scout question carries the same evidence rules:

- Read-only commands only: nothing that writes, deletes, moves, restarts or grants.
- Evidence is the literal command and its sanitized output.
- Secrets, tokens, account ids, hostnames not already in the Systems table, and personal data are masked.
- Never customer rows, only schemas, names and counts.

A brief that breaks these rules is discarded and its question asked once more. Each discovered thing becomes an `## Inventory` row (`I-1`, `I-2`, ...) citing its brief as evidence.

Then you confirm the boundary. The Planner shows the inventory grouped by system, with the rows it proposes to exclude and a one-line reason each. An excluded row gets a decision; a row nobody covers and nobody excludes fails the completeness check later.

### 4. Confirm the epics

The Planner drafts epics so every non-excluded inventory row and every requirement lands under at least one. Each epic has a goal in your product language, the requirements it `satisfies`, the inventory rows it `covers`, and `depends_on` other epics where order is forced.

Before you see it, an inspector sketches its own epic split blind, then compares: coverage gaps, overlap, missed ordering, an epic that is really two initiatives. The Planner rules on each finding in the batch. You confirm one batch that creates the epics and publishes an epic ticket for each.

### 5. Pick the drill order

| Mode | What it does | Good for |
|------|--------------|----------|
| `bfs` | every epic gets its features before any feature gets stories | sizing the whole initiative early |
| `dfs` with a `focus` node id | drills under one epic or feature until its leaves are ready | getting one slice cooking soon |

The mode, focus and `max_depth` are saved in `ROADMAP.md` frontmatter. You can change them at the start of any round.

### 6. Drill in rounds

Each round:

1. **Frontier.** `brigade-roadmap next` prints up to seven open nodes for the saved mode, then the parked ones with the questions that park them.
2. **Ground.** Nodes without a brief get one scout question each, under the same evidence rules.
3. **Draft.** Each node is either split into children one level down (epic, feature, story, task) or marked a leaf. A leaf gets the full ticket body: `## Goal`, `## Context`, `## Acceptance criteria` as checkboxes, `## Constraints`, `## Out of scope`, exactly one `repo`, a size of `XS`, `S` or `M`, and its brief.
4. **Inspector pass.** An inspector checks that each leaf is one outcome, every criterion is mechanically checkable, and the split leaves no requirement or inventory row uncovered.
5. **Check.** The Planner writes the drafts into a temporary copy of the roadmap and runs `brigade-roadmap check` on it. Every problem is fixed or turned into an open question before you see the batch.
6. **Confirm once.** You see the batch: per node, split or leaf, the children or the leaf's goal and criteria, the inspector rulings and any new open questions. One yes covers the whole round.
7. **Apply.** Operations run in order, each read back before its receipt is written.
8. **Publish ready leaves.** See the next section.

Repeat rounds as long as you want to. One round, one confirmation.

### 7. Publish ready leaves as tickets

A leaf that passes `check` and has no ticket goes into a publish batch. Publishing:

- creates a top-level ticket (never a subtask) with planning status `backlog`;
- puts the roadmap context line first under `## Context`;
- on markdown boards, also writes the frontmatter keys `roadmap`, `node`, `epic`, `parent_ticket`, `blocked_by` and `satisfies`;
- writes the new ticket id back into the node's `ticket`.

The context line is the portable record every source understands:

```text
Roadmap: <slug>/<node-id> | <epic title> > <parent title> | satisfies <R-ids> | blocked by <ticket ids>
```

Leaves publish in dependency order, prerequisites first. A leaf whose `depends_on` names an unpublished node waits. A leaf whose prerequisite is published carries that ticket id in `blocked_by`. A split prerequisite counts as published once every leaf under it is, and the dependent lists all of those leaves' tickets.

Before creating a ticket, the Planner searches the board for one that already names the node, so a crash mid-publish never makes duplicates. After every publish batch on a markdown board it runs the linking pass, `brigade-roadmap links <dir> --board <board_dir>`, and proposes any missing `blocked_by` edits in the same confirmed batch.

### Resume and refresh

Resume is mechanical: nothing that a batch already applied is re-grilled, re-inventoried or re-confirmed.

1. The Planner validates the folder and runs `check`.
2. Any batch at `state: approved` was confirmed but not finished. It is replayed: operations with a receipt are read back, operations without one are applied. A `proposed` batch is never applied without your confirmation.
3. The frontier comes from `brigade-roadmap next`, and the Planner tells you in two lines where things stand.

`refresh` is lease, roll-up, view, report, release. On a markdown board the roll-up is `brigade-roadmap sync`; other sources read each published ticket through the adapter and write statuses back through a batch.

### What you get at the end of a session

- nodes drilled, leaves ready, leaves published with ticket ids, parked nodes;
- open questions by name, with the node each one parks;
- coverage gaps from `check --complete`, and systems still at `access: missing`;
- a suggestion of which published leaves to cook first;
- the path to `roadmap.html`, with an offer to share it.

Only one session works on a roadmap at a time: it holds the `roadmap-<slug>` lease for every write and releases it before every question it asks you. A roadmap held by another session is read-only.

## Where a roadmap lives

Roadmaps live under `roadmap_dir`, set in the `## Repo` section of `.brigade/config.md` (default `.brigade/roadmaps`). See [Configuration](configuration.md).

```text
<roadmap_dir>/<slug>/
  ROADMAP.md        intent, systems, inventory, requirements, decisions, open questions, batch log
  nodes/<id>.md     one file per epic, feature, story or task
  batches/<n>.md    one file per confirmed round of changes
  briefs/           scout briefs, the evidence for inventory rows and leaves
  findings/         inspector findings per round
  roadmap.html      the rendered view
```

Nothing under `.brigade/` is committed. The full field lists are the `roadmap`, `roadmap_node` and `roadmap_batch` types in [`SCHEMAS.md`](../skills/brigade/SCHEMAS.md); see also [Artifacts](artifacts.md).

### ROADMAP.md

Frontmatter carries `mode` (`bfs` or `dfs`), `focus` (a node id, or `""` for bfs), `max_depth`, and `next_ids`, the next free id per level letter. Ids are never reused, even when a proposed batch is abandoned.

Body sections, in order: `## Intent`, `## Original request`, `## Systems`, `## Inventory`, `## Requirements`, `## Decisions`, `## Open questions`, `## Out of scope`, `## Batches`.

### Nodes

| Level | Id prefix | Example |
|-------|-----------|---------|
| epic | `E-` | `E-1` |
| feature | `F-` | `F-3` |
| story | `S-` | `S-1` |
| task | `T-` | `T-10` |

The level must match the id's letter. Every node below an epic names a `parent`. Each node has a drill state:

| `drill` | Meaning |
|---------|---------|
| `open` | not drilled yet; on the frontier |
| `split` | has children; needs at least one node naming it as parent |
| `leaf` | one ticket's worth of work; must pass the readiness rules |
| `parked` | waiting on an open question, or stuck at `max_depth` |

Other keys: `satisfies` (requirement ids), `covers` (inventory ids), `depends_on` (node ids), `repo` (required on a leaf), `ticket` and `status` once published, `size_swag` (`XS`, `S`, `M`, `L`, `XL` or `unknown`), and `sources` (briefs).

### When a leaf is ready

A leaf is ready only when all of these hold:

- a `## Goal` with text;
- at least one checkbox under `## Acceptance criteria`;
- exactly one `repo`;
- `satisfies` or `covers` is not empty;
- `size_swag` is `XS`, `S` or `M` (an `L` or `XL` node splits again);
- no open question on it or any ancestor;
- at least one brief in `sources`.

### What parks a node

- **An open question.** A question whose text names a node id parks that node and its whole subtree. Questions are named, never numbered, in this format:

  ```text
  - **<name>** - `research|grilling|prototype|task` · AFK|HITL - <node id>: <the question>. Blocked by: <name>|none
  ```

  `research` questions are answered by a scout wave, `grilling` ones by asking you. The answer moves to `## Decisions` and the node goes back to `drill: open`.
- **Max depth.** A node at `max_depth` that still isn't a ready leaf is parked with a question saying what would let it become one.

Leaves never carry work packets, file lists or verify commands. Those are built at dish time from fresh research.

## Check and query a roadmap with the CLI

`brigade-roadmap` reads a roadmap folder and never calls a model. Inside a session it lives at `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap"`; see [Scripts](scripts.md).

```text
brigade-roadmap check [--json] [--complete [--board <board_dir>]] <dir>
brigade-roadmap next [--json] <dir>
brigade-roadmap sync <dir> --board <board_dir> [--config <config.md>]
brigade-roadmap links [--json] <dir> [--board <board_dir>]
brigade-roadmap status <dir>
```

Exit codes: `0` fine, `1` problems found, `2` a usage or I/O error (including a folder with no `ROADMAP.md`).

### check

Fails on duplicate ids, dangling references, parent and dependency cycles (with the cycle path), a `drill: leaf` node that is not ready (naming the unmet rules), a `drill: split` node with no children, and any file that did not parse cleanly. Prints one `<code>: <id>: <message>` line per problem, or `roadmap OK: <n> nodes, <m> leaves ready`.

`--complete` adds the "are we done" checks:

| Code | Meaning |
|------|---------|
| `open_node` | a node is still `drill: open` |
| `parked_node` | a node is parked, with the questions that park it |
| `uncovered_inventory` | no node covers the row and no decision excludes it; a parked branch covers nothing |
| `unsatisfied_requirement` | an accepted requirement no leaf satisfies |
| `unpublished_leaf` | a ready leaf with no ticket |

`--complete --board <board_dir>` also runs the links check against that board. `--json` prints `ok` and a `problems` list instead of text.

The roadmap is complete only when `check --complete` exits 0.

### next

Prints the next drill batch (up to seven nodes) for the saved mode and focus, then the parked nodes with the questions that park them. In `bfs` the batch is the shallowest open nodes; in `dfs` it is the deepest open nodes under the focus. It prints `focus complete: <id>` when a dfs focus has no open node left. `--json` adds depth per node.

### status

Prints each epic's status, derived from its children, and each requirement as `met` (every leaf that satisfies it is done) or `unmet`. Parent status and "met" are always derived; never write them by hand.

### sync

For each node with a `ticket`, finds the matching ticket file in a markdown board folder (by frontmatter `id`, or file name), maps its status back to Brigade's status word through the status mapping in the nearest `.brigade/config.md` (or `--config`), and copies it into the node. Prints one line per change and a summary. It reads the board and never writes it.

### links

For every published node, each `depends_on` node that is also published must appear in the dependent ticket's `blocked_by`: on the board file with `--board`, otherwise in the node's own `blocked_by`. A split prerequisite stands for its leaves. A prerequisite leaf with no ticket yet prints a `pending:` line, which is not a failure. Run it after every publish batch.

## See the roadmap as a page

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap-view" <dir> [--out <path>]
```

It writes one self-contained, offline HTML page (default `<dir>/roadmap.html`) and prints its path. The same roadmap always gives the same bytes: no clock, no network, no scripts in the output. Anything wrong with the roadmap is listed at the top and the page still renders.

A header shows mode, focus, max depth, and counts of epics, nodes, leaves, requirements met, batches and problems. Four views sit behind the top nav:

| View | Shows |
|------|-------|
| Outline | the node tree, each node with its level, drill state, requirements, inventory, ticket and status |
| Dependencies | a graph of epics with cross-epic dependencies counted, then one graph per epic |
| Boards | each epic's leaves in lanes: Backlog, Todo, In progress, In review, Done, Blocked, Unpublished |
| Coverage | inventory nobody covers, accepted requirements with no leaf, leaves with no requirement, open questions, cycles, systems with missing access, requirements met |

A leaf with no ticket always sits in Unpublished, whatever its status says. The Planner offers to share the page only after checking it holds no secrets, hostnames or personal data beyond what the board already shows. The file is never committed.

## Cook a published leaf

A published leaf is an ordinary ticket on your board. To cook it, name the ticket and say go, and a [dish](usage.md) starts from it like any other ticket. The leaf's goal, acceptance criteria, constraints and out-of-scope sections become the dish's starting point; its file list and plan come from fresh research at dish time.

If the ticket's `blocked_by` names a ticket that isn't finished, the Planner asks whether to wait for the blocker or go ahead and record why.

Once leaves start moving, `refresh` brings their statuses back into the roadmap so `status` and the view stay current.
