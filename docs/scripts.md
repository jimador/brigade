---
title: Scripts
description: Reference for the helper scripts Brigade runs at zero model tokens, with every subcommand, flag, exit code and an example.
---

Brigade does its mechanical work with small scripts instead of model calls: reading state, resolving config, checking artifacts, holding leases, gating scope and PR descriptions. This page lists each one with its synopsis, flags, exit codes and an example.

## How to run them

The scripts live in the plugin's `scripts/` folder. They are not on your `PATH`. Inside a Claude Code session the plugin root is in `CLAUDE_PLUGIN_ROOT`, so commands, skills and agents call them like this:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-status"
```

From your own terminal, set the variable to the plugin's install folder first, or use the full path:

```bash
CLAUDE_PLUGIN_ROOT=/path/to/brigade
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate" .brigade/dishes/acme-42
```

What they have in common:

- **Zero model tokens.** Every script here except `brigade-eval` is plain Node or shell. Nothing calls a model.
- **No dependencies.** Node scripts use only the standard library. `brigade-status --json` is the one path that needs `jq`.
- **They find the repo for you.** Most look for the repo in `BRIGADE_PROJECT_DIR`, then `CLAUDE_PROJECT_DIR`, then `CODEX_PROJECT_DIR`, then the nearest folder above the current one that has a `.brigade/` folder, then the git top level.
- **`--json` for machines.** Most scripts print short text by default and structured JSON with `--json`.

## At a glance

| Script | What it answers |
| --- | --- |
| [`brigade-status`](#brigade-status) | What state are the dishes, worktrees and retros in? |
| [`brigade-config`](#brigade-config) | What settings win, from which layer, and are they valid? |
| [`brigade-validate`](#brigade-validate) | Do these artifacts match their schemas? |
| [`brigade-coord`](#brigade-coord) | Who holds this dish, and which paths are leased? |
| [`brigade-evidence`](#brigade-evidence) | What does a verification command actually prove? |
| [`brigade-risk`](#brigade-risk) | Should this change escalate? |
| [`brigade-scope`](#brigade-scope) | Did an item change only the files its packet lists? |
| [`brigade-rehearse`](#brigade-rehearse) | Will this plan survive dispatch? |
| [`brigade-plan-view`](#brigade-plan-view) | What does this plan look like as a page? |
| [`brigade-pr`](#brigade-pr) | Is the PR description complete, the layer small, the red team set up? |
| [`brigade-onboard`](#brigade-onboard) | Is this repo set up for the installed version? |
| [`brigade-roadmap`](#brigade-roadmap) | Is this roadmap sound, and what gets drilled next? |
| [`brigade-roadmap-view`](#brigade-roadmap-view) | What does this roadmap look like as a page? |
| [`brigade-eval`](#brigade-eval) | Do the skills and agents still answer their eval cases? |
| [`brigade-bundle`](#brigade-bundle) | Are the generated workflow files up to date? |

## brigade-status

A snapshot of dish state for context injection: config pairs, the service tier, each dish's items and their status with totals, report files, the Planner's live ledger, efficiency numbers from analyst retros, worktrees, stale worktrees with a cleanup command, and the latest learnings headers. `/brigade:status` is built on it.

```text
brigade-status [--json]
```

- `--json`: structured output for tooling. Needs `jq`.

Exit codes: 0 normally, including when the repo has no `.brigade/` (it prints nothing, or `{"brigade": false}` with `--json`). 1 when `--json` is asked for and `jq` is missing.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-status" --json
```

## brigade-config

Resolves the layered configuration: built-in defaults, then `.brigade/config.md` (only `tier`, `verification_gate` and `main_branch` from its `## Repo` section), then `~/.brigade/config.json`, then `brigade.config.json`, then `.brigade/config.local.json`. Later layers win key by key. Prompt and agent overrides stack instead: every layer's text is appended in order. See [Configuration](configuration.md) and [Overrides](overrides.md).

```text
brigade-config resolve [--json]
brigade-config get <dotted.key> [--json]
brigade-config layers [--json]
brigade-config prompts [--json]
brigade-config prompt <name>
brigade-config doctor [--json]
brigade-config writing [--json] [--preset <name>]
```

- `resolve`: the merged settings and where each key came from. This is the default when no subcommand is given.
- `get <dotted.key>`: one value and the layer that set it.
- `layers`: which layer files exist, in precedence order.
- `prompts`: the override stacks, by name.
- `prompt <name>`: the resolved override text for one name.
- `doctor`: validates every layer and explains what is wrong. Advisory notes never fail it.
- `writing`: the writing rules and checks for each artifact type. `--preset <name>` (or `--preset=<name>`) picks a preset; the shipped ones are `none` and `ste-80`.

Exit codes: 0 ok. 1 when `doctor` finds problems, `get` can't find the key, or `writing` gets an unknown preset. 2 for a usage or I/O error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" get tier
```

## brigade-validate

Checks dish and roadmap artifacts against [the schemas](artifacts.md): the envelope keys, required keys per type, enum values, plan DAG sanity, plan tables, and body length budgets. `/brigade:validate` runs it with no arguments.

```text
brigade-validate [--json] [--ticket <ticket.md>] [<path>...]
```

What it checks depends on what you pass:

- Nothing: every dish and roadmap under `.brigade/`.
- A markdown file: that artifact.
- A dish folder: `PLAN.md`, `analyst.md`, `DESIGN.md` and the `.md` files in `briefs/`, `reports/`, `research/` and `state/`.
- A roadmap folder: `ROADMAP.md` and the `.md` files in `nodes/`, `batches/` and `briefs/`.
- Any other folder: the `.md` files directly inside it.

Flags:

- `--json`: machine-readable results.
- `--ticket <ticket.md>`: on a markdown board, also checks that the plan carries exactly as many `TP<k>` lines as the ticket's own test plan has items.

Each artifact prints as `ok`, `FAIL` or `warn`, then a count of nonconforming files. Writing checks on packets (from a plan's `writing:` preset) only ever add warnings.

Exit codes: 0 all conforming (warnings allowed), 1 violations found, 2 usage or I/O error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-validate" --ticket tickets/ACME-42.md .brigade/dishes/acme-42/PLAN.md
```

## brigade-coord

Atomic single-writer leases, shared by Claude and Codex sessions. A lease protects one dish's control plane (or a review or roadmap key), so two sessions never write the same dish. Leases don't expire on a timer: a paused human checkpoint is not proof the owner died. Output is JSON. See [Architecture](architecture.md).

```text
brigade-coord key <source> <ticket-id>
brigade-coord review-key <ref>
brigade-coord acquire <dish> claude|codex
brigade-coord status <dish>
brigade-coord heartbeat <dish> <owner>
brigade-coord release <dish> <owner>
brigade-coord break <dish> --force
brigade-coord recover-lock <dish> --force
brigade-coord list
brigade-coord watch [--runtime <name>] [--interval <seconds>] [--once --state <file>]
brigade-coord preflight <dish> --branch <name> [--json]
brigade-coord path-acquire <dish> <owner> <path>...
brigade-coord path-release <dish> <owner>
brigade-coord path-list
brigade-coord hot-files [--days <n>] [--min <n>] [--json]
```

- `key`: the dish slug for a ticket. Reuses an existing dish whose `PLAN.md` names the same source and ticket, else derives one.
- `review-key`: the slug and lease name for a review ref. `feature/Foo_Bar` becomes `feature-foo-bar`.
- `acquire`: takes the lease and returns an `owner` token. Keep it: `heartbeat`, `release` and the path commands need it.
- `status`: whether a dish is held, and by whom.
- `heartbeat`: refreshes the lease timestamp.
- `release`: drops the lease and the dish's path leases.
- `break --force`: archives a lease someone else holds, for operator-approved recovery. The evidence is kept, not deleted.
- `recover-lock --force`: archives a stuck operation lock. Pass `.path-leases` to clear the shared path-lease lock.
- `list`: every lease.
- `watch`: a change feed of what the other runtime does: leases taken, released or changing hands, and reports landing in dishes this session doesn't hold. The plugin's monitor runs it. `--runtime` names your own runtime (default `claude`), `--interval` sets the poll in seconds (default 5, minimum 2), and `--once --state <file>` runs a single diff against a saved state file.
- `preflight`: before cutting a delivery branch, checks for local and remote branch collisions, an open PR on the branch, files another active dish still has in flight, and two dishes racing for the same branch. A check that can't run (no remote, no `gh`) is reported as unchecked with a reason.
- `path-acquire`: leases repo paths for a dish so no other live dish edits them. Needs the dish lease first. Absolute paths and `..` are refused.
- `path-release`: drops a dish's path leases.
- `path-list`: every dish's leased paths and whether its lease is live.
- `hot-files`: files several dishes changed on the main branch lately. `--days` sets the window (default 30) and `--min` the dish count (default 3).

Dish names must match `[a-z0-9][a-z0-9._-]*`.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Usage error, bad input, or `preflight` found conflicts |
| 2 | Owner token mismatch, `path-acquire` without a held dish lease, or a `preflight` usage error |
| 3 | `acquire` found the lease held, or `path-acquire` found a path another dish holds |
| 4 | No lease to act on, an invalid lease, or an ambiguous existing dish for `key` |
| 5 | Another coordination operation is running on the same lock |

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" acquire acme-42 claude
```

## brigade-evidence

Classifies what a verification command proves, so a green exit never reads as more than it is. Each command gets a kind (`lint`, `typecheck`, `build`, `format`, `check`, `test`) and a scope: `full`, or `targeted` when it names files or uses a narrowing flag such as `--filter`, `--workspace` or `-k`. It inspects the command text only and runs nothing.

```text
brigade-evidence classify [--json] <command>...
brigade-evidence cover [--json] --claim <kind>[,<kind>...] -- <command>...
```

- `classify`: kind, scope, targets and narrowing flags for each command.
- `cover`: whether each claimed kind has at least one full-scope command. With no `--claim`, it checks every kind the commands cover.

Exit codes: 0 clean, 1 a claimed kind is missing or only covered by a targeted run, or bad usage.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-evidence" cover --claim test,lint -- "npm test" "npm run lint"
```

## brigade-risk

Decides whether a change escalates, using the policy table in [`skills/brigade/policies/risk-escalation.md`](../skills/brigade/policies/risk-escalation.md). A change escalates when it touches more files than the threshold or any path matches a risk category such as auth, secrets or CI. Paths that match a design-review category are listed separately. Set `BRIGADE_RISK_POLICY` to point at a different policy file.

```text
brigade-risk [--json] --files <path>...
brigade-risk [--json] --range <A..B>
```

- `--files`: the changed paths.
- `--range`: takes the changed paths from `git diff --name-only` over the range.
- `--json`: the full result, including `escalate`, the matches and any design-review matches.

Text output lists each `category  path` match, a `design-review:` line when one applies, the file count against the threshold, and `escalate: yes` or `no`.

Exit codes: 0 evaluated (whatever the answer), 1 the policy file or the git range could not be read, 2 usage error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-risk" --range main...feature/checkout-retry
```

## brigade-scope

Checks the files an item changed against its packet's `files` list in `PLAN.md`. A changed path outside the list is out of scope. A changed path that a `contract: true` item lists is contract-owned, unless the item being checked is itself a contract item. An entry ending in `/` covers everything under that folder.

```text
brigade-scope [--json] [--base <ref>] [--head <ref>] <PLAN.md> <item-slug>
```

- `--base`: the ref to diff from. Defaults to the plan's `delivery_branch`.
- `--head`: the ref to diff to. Defaults to `HEAD`.
- `--json`: the item, refs, changed files, out-of-scope and contract-owned paths, and `ok`.

Exit codes: 0 scope holds, 1 violations found, 2 usage or I/O error (including no base and an unknown item).

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-scope" .brigade/dishes/acme-42/PLAN.md retry-backoff
```

## brigade-rehearse

Runs the pipeline's mechanical checks over a whole plan before anything is dispatched, so a wrong premise or a scope clash shows up while it's cheap to fix. It cooks nothing and changes nothing in your tree. Checks:

- `validate`: every FAIL from `brigade-validate`.
- `premise`: a path marked `(edit)` that is missing at the base, or one marked `(create)` that already exists.
- `owner`: a non-contract item listing a contract item's path.
- `overlap`: two items with no dependency path between them listing the same file.
- `chain`: a file listed by three or more items (warning).
- `risk`: `brigade-risk` escalates an item that isn't `heavy: true`.
- `pin`: test files the item doesn't list mention a file it edits (warning).
- `premise FAIL`: a packet's premise command exits non-zero on the base.
- `verify UNRUNNABLE`: a Verify command fails on the base for a reason the change can't fix.
- `verify incomplete`: a Verify line never ran because the block ended early.

Premise and Verify commands run in a temporary detached worktree of the base, reset before each packet and removed afterwards, with a 60 second limit each.

```text
brigade-rehearse <PLAN.md> [--base <ref>] [--json] [--no-exec]
```

- `--base`: the ref to rehearse against. Defaults to the plan's `delivery_branch`; when that is unset or doesn't exist yet, it falls back to the main line and prints one `base:` line saying so.
- `--json`: one JSON object per finding, one per line.
- `--no-exec`: skips running premise and Verify commands and prints `premises: skipped`.

Run it from inside the repository the plan describes.

Exit codes: 0 no findings (warnings allowed), 1 findings, 2 usage or I/O error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-rehearse" .brigade/dishes/acme-42/PLAN.md --no-exec
```

## brigade-plan-view

Renders a `PLAN.md` as one self-contained HTML page: dish facts, status counts, a dependency graph, the items table and parked questions. The same plan always gives the same bytes. It prints the path it wrote.

```text
brigade-plan-view [--out <path>] <PLAN.md>
```

- `--out`: where to write. Defaults to `plan.html` next to the plan.

Exit codes: 0 written, 1 the plan has no parseable items, 2 usage or I/O error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-plan-view" .brigade/dishes/acme-42/PLAN.md
```

## brigade-pr

The PR description and the handoff red team. Everything it knows comes from the resolved config (`prTemplate` and `review.redTeam`), so a repo changes sections, lenses or review tools in a config layer. See [Reviews](reviews.md) and [Configuration](configuration.md).

```text
brigade-pr template
brigade-pr check <body-file> [--base <ref>] [--head <sha>] [--ready] [--ui | --no-ui] [--json]
brigade-pr check --pr <number> [--base <ref>] [--ready] [--ui | --no-ui] [--json]
brigade-pr size [--base <ref>] [--head <sha>] [--json]
brigade-pr redteam [--author <tool>] [--base <ref>] [--head <sha>] [--brief <file>] [--findings <file>] [--json]
brigade-pr commits [--base <ref>] [--head <ref>]
```

- `template`: prints the PR body skeleton from `prTemplate.sections`.
- `check`: checks a description against the template, from a file or from an open PR (`--pr`, read with `gh`). It also reports when the layer is over the size limit. `--ready` also requires a clean red-team verdict, or a human override, in the review section: run it before marking a PR ready. `--ui` or `--no-ui` says whether the change is a UI change, for sections that are required only then.
- `size`: changed lines in this layer against its parent, with excluded files listed.
- `redteam`: picks the find and verify tools, fills their commands, and with `--brief` writes the reviewers' brief. `--author` names the tool that wrote the code (default `claude`). `--findings` fills the findings path into the commands.
- `commits`: refuses `WIP`, `fixup!` and `squash!` commit subjects in the range before the branch is pushed.

`--base` defaults to the configured `mainBranch` (for `check --pr`, the PR's own base).

Exit codes: 0 ok. 1 a check failed, or no review tool is installed, or neither red-team pass runs in a Claude session. 2 usage or input error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-pr" check pr-body.md --ready
```

## brigade-onboard

Checks and applies the one-time setup a repo needs: a `.git/info/exclude` entry so `.brigade/` is never committed by accident, a record of which plugin version last touched the repo, and the board config the onboard skill walks you through. It also tracks how far open work has been upgraded against the ledger in [`skills/onboard/UPGRADES.md`](../skills/onboard/UPGRADES.md). `/brigade:onboard` and `/brigade:upgrade` read it. See [Installation](installation.md).

```text
brigade-onboard status [--json]
brigade-onboard apply [--json]
brigade-onboard detect [--json]
brigade-onboard work-record [--json]
```

- `status`: the state of each setup step and the open-work upgrade gap.
- `apply`: converges the automatic steps and writes `.brigade/onboard.json`. It never touches the interactive board-config step.
- `detect`: reads repo signals, read-only, so onboarding only asks what it can't infer.
- `work-record`: marks open work as upgraded to the installed version in `.brigade/upgrade.json`.

This script reads the repo from `CLAUDE_PROJECT_DIR`, else the current folder.

Exit codes: 0 ok, 1 a step failed to check, apply or write, 2 usage error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-onboard" apply
```

## brigade-roadmap

Checks and walks a roadmap folder (`ROADMAP.md`, `nodes/`, `batches/`). See [Roadmaps](roadmap.md).

```text
brigade-roadmap check [--json] [--complete [--board <board_dir>]] <dir>
brigade-roadmap next [--json] <dir>
brigade-roadmap sync <dir> --board <board_dir> [--config <config.md>]
brigade-roadmap links [--json] <dir> [--board <board_dir>]
brigade-roadmap status <dir>
```

- `check`: fails on duplicate ids, dangling references, parent and dependency cycles, a leaf that isn't ready, a split node with no children, and files the parser couldn't read. `--complete` also fails on open or parked nodes, uncovered inventory rows, accepted requirements no leaf satisfies, and ready leaves with no ticket; with `--board` it runs `links` against that board too. Prints `roadmap OK: <n> nodes, <m> leaves ready` when clean.
- `next`: the next drill batch for the saved mode and focus, then the parked nodes and their open questions.
- `sync`: copies each published leaf's ticket status from a markdown board back into its node, translated through the board's status mapping in the nearest `.brigade/config.md` (or `--config`). Reads the board, never writes it.
- `links`: checks that every published node's prerequisites appear in its ticket's `blocked_by`, on the board file with `--board`, else in the node. A prerequisite with children stands for its leaves; a leaf not published yet prints a `pending:` line, which is not a failure. Run it after every publish batch.
- `status`: the derived status of every epic and every requirement.

Exit codes: 0 fine. 1 problems found by `check`, a frontier `next` can't answer, tickets `sync` couldn't match, or missing links. 2 usage or I/O error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap" check --complete .brigade/roadmaps/warehouse-migration
```

## brigade-roadmap-view

Renders a roadmap folder as one self-contained HTML page with four sections: Outline, Dependencies, Boards and Coverage. Problems with the roadmap are listed at the top and the page still renders. The same roadmap always gives the same bytes. It prints the path it wrote.

```text
brigade-roadmap-view <dir> [--out <path>]
```

- `--out`: where to write. Defaults to `roadmap.html` inside the roadmap folder.

Exit codes: 0 written, 2 usage or I/O error (including a path that isn't a folder).

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-roadmap-view" .brigade/roadmaps/warehouse-migration
```

## brigade-eval

Runs prompt evals against the skills and agents the plugin ships. Each case sends a prompt to a model with the surface's file as its system prompt and checks the reply: contains a phrase, avoids one, matches a regex, or meets a criterion judged by a second model call. Cases live in `skills/*/evals.json` and `agents/evals.json`. This is the one script that spends model tokens. See [Experiments](experiments.md).

```text
brigade-eval [--json] [--only <case-name>] [--list]
```

- `--only`: run one case by name.
- `--list`: print the case names without running anything.
- `--json`: machine-readable output.

The backend is picked once at startup: `BRIGADE_EVAL_MOCK` (a folder of canned replies) wins, then `ANTHROPIC_API_KEY` for direct API calls, then a `claude` binary for headless runs. With none of them it prints `skipped` and exits 0. Each run leaves a record under `.brigade/evals/`.

Exit codes: 0 passed or skipped, 1 a case failed or the case files are invalid, 2 usage error.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-eval" --list
```

## brigade-bundle

A contributor tool. Regenerates `workflows/brigade-*.js` from `workflows/src/*.js` and `workflows/config.js`, and rewrites the generated schema entries in `config.js` from `scripts/lib/schemas.mjs`. Never hand-edit the generated files. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

```text
brigade-bundle [--check]
```

- `--check`: regenerates in memory and compares with the committed files, writing nothing.

Exit codes: 0 written or up to date, 1 something is stale or missing, or the bundle failed.

```bash
scripts/brigade-bundle --check
```

## Other scripts

- `board-demo` is a contributor tool that draws the animated board shown in [Run a dish](usage.md#watch-the-live-board) through the board's own code. `--check` exits 1 if the committed picture is out of date; `--text` prints every frame as text.
- `brigade-subagent-line` draws the agent-panel row for Brigade's own subagents: role, packet or question, model, and context use. The plugin's `settings.json` wires it in as the subagent status line; you never run it by hand.
