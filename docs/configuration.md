---
title: Configuration
description: Where Brigade reads its settings, every key you can set, and how to see which layer won.
---

Brigade runs with no configuration at all. When you want to change how it behaves, this page
shows where each setting lives, what every key does, and how to check which value won.

## How the layers stack

Settings come from five layers. Later layers win, key by key, so you can change one thing
without restating everything above it.

| # | Layer | File | Committed? | Scope |
| --- | --- | --- | --- | --- |
| 1 | defaults | built into `scripts/brigade-config` | n/a | what Brigade does with no config |
| 2 | config.md | `.brigade/config.md`, `## Repo` section | no | only `tier`, `main_branch` and `verification_gate` |
| 3 | global | `~/.brigade/config.json` | no | you, every repo |
| 4 | team | `brigade.config.json` at the repo root | yes | everyone in this repo |
| 5 | local | `.brigade/config.local.json` | no | you, this repo |

`brigade-config` answers every question about the stack at zero model tokens. Reach for it
before asking Claude to read config files.

```bash
brigade-config resolve          # merged settings, with the winning layer per key
brigade-config layers           # which layer files exist, in precedence order
brigade-config get tier         # one value, and the layer that set it
brigade-config doctor           # validate every layer
brigade-config prompts          # prompt override stacks, by role
brigade-config writing          # writing rules and checks per artifact
```

The helpers live in the plugin's `scripts/` folder and are not on your PATH. Inside a session
Brigade calls them as `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config"`, and the SessionStart
hook prints that folder. `/brigade:config` prints the same picture inside a session.

## Board wiring versus fleet behavior

Two kinds of file, two jobs.

`.brigade/config.md` is markdown, per repo, never committed. The onboarding interview
(`/brigade:onboard`) writes it from
[`skills/brigade/templates/config.md`](../skills/brigade/templates/config.md). It holds the
board wiring: the ticket source and transport, the board id, your identity on the board,
property names, the status mapping, and a `## Repo` section with repo facts.

The JSON layers hold fleet behavior: tier, agents per role, parallelism, thresholds, context
sources, review and PR settings, writing rules and prompt overrides. They are optional.

`brigade-config` reads three keys from the `## Repo` section of `config.md` as layer 2:
`tier`, `main_branch` (as `mainBranch`) and `verification_gate` (as `gate`). Any JSON layer
beats them. Unfilled template placeholders are ignored, so the layers below still show through.

### Repo keys in config.md

| Key | Read by | What it does |
| --- | --- | --- |
| `main_branch` | `brigade-config` | the line delivery branches are cut from |
| `tier` | `brigade-config` | the repo's default tier |
| `verification_gate` | `brigade-config` | the commands every cook runs and pastes output from |
| `roadmap_dir` | `/brigade:roadmap` | where roadmap folders live; default `.brigade/roadmaps` |
| `test_convention` | the Planner | one line on how tests are written here |
| `remote_pr` | the Planner | `false` stops handoff at a local branch |
| `graphite_restack`, `graphite_platform` | the Planner | Graphite stacking, both off by default |

`roadmap_dir` is read once at the start of a `/brigade:roadmap` session, and every roadmap
folder sits at `<roadmap_dir>/<slug>/`. See [Roadmaps](roadmap.md).

## Fleet shape

```json
{
  "tier": "two-star",
  "plannerModel": null,
  "mainBranch": "main",
  "maxParallel": 4,
  "gate": ["bun run types", "bun test"],
  "worktreeRoot": null,
  "remotePr": true,
  "workingMemory": true
}
```

- `tier`: `three-star`, `two-star` or `one-star`. Sets model spend per dish; see
  [Tiers](tiers.md). Saying "brigade heavy" or "brigade light" beats it for one dish.
- `plannerModel`: the model the Planner session should run on, as a model alias or full id
  (`fable`, `opus`, `sonnet`, `haiku`, `claude-...`), never an agent type. `null` takes the
  tier's planning row.
- `mainBranch`: the line delivery branches are cut from.
- `maxParallel`: how many cooks run at once. Lower it on a laptop or with a slow test suite.
- `gate`: the verification commands every cook must run and paste real output from.
- `worktreeRoot`: where item worktrees go. `null` means `.brigade/worktrees` in the repo.
  Set it when the repo lives on a slow or size-capped volume.
- `remotePr`: `false` stops handoff at a local integration branch instead of a PR.
- `workingMemory`: `false` turns off the ledger the execute workflow attaches to heavy items
  and rework attempts, at every tier.

## Policy

```json
{
  "policy": {
    "scoutCap": null,
    "planCheck": null,
    "retro": null,
    "heavyShareWarn": 0.2
  }
}
```

`null` takes the tier's value. Set a key to decouple it from the tier, for example to keep
cheap cooks but always run the adversarial plan check on a repo where a bad decomposition is
expensive.

- `scoutCap`: the most scouts dispatched per research round.
- `planCheck`: `always`, `triggers` or `never`.
- `retro`: how often the analyst pass runs.
- `heavyShareWarn`: the share of `heavy` items above which the decomposition is probably
  too coarse.

## Agents per role

```json
{
  "models": {
    "scout": null,
    "cook": null,
    "cookRetry": null,
    "cookHeavy": null,
    "inspector": null,
    "analyst": null,
    "design": null,
    "designer": null,
    "steward": null
  }
}
```

Each key takes an agent type: the name the Agent tool dispatches, such as
`brigade:brigade-cook` or one of your own agents. `null` keeps the shipped agent. This is the
seam for a team-specific reviewer, a domain-trained cook or a cheaper steward, with no edit
to the workflow scripts.

The tier still sets the escalation ladder; these keys only decide which agent fills each rung.

| Key | Rung | Default |
| --- | --- | --- |
| `cook` | first attempt at two-star and one-star | `brigade:brigade-cook` |
| `cookRetry` | retry after an inspector FAIL at two-star and one-star | the same agent as `cook` |
| `cookHeavy` | the heavy rung everywhere, and every three-star attempt | `brigade:brigade-cook-heavy` |

Point `cookRetry` at a stronger agent to make the retry rung a real escalation instead of a
second roll of the same dice. The three-star ladder is heavy attempts only and ignores `cook`
and `cookRetry`.

Every verdict comes from a sonnet-class or stronger reviewer. `doctor` rejects a haiku-class
name in `models.inspector`, and a `brigade:<name>` agent whose agent file sets `model: haiku`.

Every Brigade agent except the steward picks its own model in its frontmatter. The steward is
a general-purpose agent with no model of its own, so Brigade pins it to `sonnet`. Without
the pin it would inherit the session's model, and a dish planned on the top-tier model would
run its `git worktree add` calls there too. Point `steward` at your own agent and the pin
drops away.

## Circuit breaker

```json
{
  "circuitBreaker": { "maxLadderExhausts": 2, "maxTotalFails": 4 }
}
```

How much failure a run absorbs before it stops and hands back to you. Repeated failures
usually mean the plan's premises were wrong, so the defaults are deliberately impatient.
Raise them only when you know the suite itself is flaky.

## Turn budgets

```json
{ "budgets": { "enabled": true, "softFraction": 0.75, "finalReserve": 3 } }
```

A PostToolUse hook (`hooks/turn-budget.mjs`) warns a running Brigade subagent twice as it
nears the `maxTurns` in its agent file, so it wraps up and reports instead of stopping
mid-task. `softFraction` (above 0, below 1) sets the wrap-up warning at that share of
`maxTurns`. `finalReserve` (an integer of at least 1) sets the final warning that many tool
calls before the cap. `enabled: false` silences both. This hook is Claude Code only.

## Graphite

```json
{ "graphite": { "restack": false, "platform": false } }
```

Both off by default. See [`skills/brigade/GRAPHITE.md`](../skills/brigade/GRAPHITE.md).

## Knowledge base

```json
{
  "kb": {
    "enabled": true,
    "cli": "your-kb-cli",
    "search_args": ["search", "--tags", "brigade,heuristic,active", "--json", "--limit", "50"],
    "ingest_args": ["ingest"]
  }
}
```

Optional. When `enabled` is true and `cli` is on your PATH, Brigade runs it to pull
cross-repo heuristics at dish start and to file new ones at retro. When the CLI is missing,
Brigade skips it silently, so no vendor is ever required. Without a knowledge base,
heuristics collect in `.brigade/LEARNINGS.md`, and a team may commit them to
`skills/brigade/policies/heuristics.md`.

## Context sources

Prior art pulled in before decomposition. Sources merge by `id`, so a later layer can retune
or disable one without restating the list.

```json
{
  "contextSources": [
    {
      "id": "repo-conventions",
      "type": "static-file",
      "enabled": true,
      "path": "docs/conventions.md",
      "preflight": ["research", "decompose"]
    }
  ]
}
```

- `type`: `static-file`, `mcp`, `skill` or `command`.
- `enabled`: `false` in a later layer switches off a source an earlier layer added.
- `localOnly`: never used by agents that run outside your machine.
- `preflight`: which phases pull this source.

Every source soft-fails: an unreachable MCP server or a missing file is logged, never fatal.
The Planner writes the gathered digest to `.brigade/dishes/<slug>/CONTEXT.md`.

## Review dimensions

`review.dimensions` follows the same merge-by-`id` shape for the eight lenses of
`/brigade:review`: `correctness`, `tests`, `architecture`, `maintainability`, `reuse`,
`duplication`, `security` and `product`.

```json
{ "review": { "dimensions": [{ "id": "security", "enabled": false }] } }
```

`enabled: false` turns off a built-in dimension, patching `title` or `lens` retunes it, and
an `id` outside the built-in set is added as a custom dimension. See [Reviews](reviews.md).

## Red team and PR template

`review.redTeam` sets the handoff red team: the lenses its find pass hunts through, the
severities, and the tools for each pass with their commands and the order they are tried in.
`prTemplate` sets the PR description: its sections, the commands whose output it must carry,
the paths that count as a UI change, and the size limit per layer. Lenses, severities,
sections and validation commands merge by `id`.

```json
{
  "review": { "redTeam": { "lenses": [{ "id": "concurrency", "enabled": false }] } },
  "prTemplate": { "sections": [{ "id": "screenshots", "enabled": false }], "size": { "maxChangedLines": 600 } }
}
```

At least one red-team pass must run in a Claude session, and `doctor` rejects a reviewer
command that names a haiku-class `--model`. `scripts/brigade-pr` reads both blocks at handoff,
at zero model tokens:

```bash
brigade-pr redteam --base main --brief <file> --json   # head, range, find and verify commands
brigade-pr template                                    # the PR body skeleton
brigade-pr check <body-file> --base main               # before the body is published
brigade-pr check --pr 123 --ready                      # before the PR leaves draft
brigade-pr size --base main                            # changed lines in this layer
```

Every key and its default is in
[`skills/brigade/CONFIG.md`](../skills/brigade/CONFIG.md) under Red team and PR template.

## Writing rules

The `writing` block says how each artifact Brigade writes should read.

```json
{
  "writing": {
    "preset": "ste-80",
    "rules": { "ticket_comment": ["Write at most five sentences."] },
    "checks": { "packet": { "terms": { "work item": ["task", "slice"] } } }
  }
}
```

- `preset`: `none` (the default) or `ste-80`, a set of short-sentence rules the Planner
  writes packets to. A later layer replaces it.
- `rules.<artifact>`: plain sentences for whoever writes that artifact. Rules stack like
  prompt overrides: every layer adds, none removes.
- `checks.packet`: what a script can check on a packet. Checks replace key by key, and `0`
  or `false` turns one off. `terms` maps the one approved term to the words that must not
  stand in for it.

The artifacts are `packet`, `plan`, `brief`, `report`, `verdict`, `ticket_comment` and
`pr_body`. Each rule set reaches only the agent that writes that artifact.

## Prompt overrides

Short additions go inline; anything longer goes in a file. Both are covered in
[Overrides](overrides.md).

```json
{
  "prompts": {
    "cook": { "append": ["Never reformat lines the packet did not ask you to change."] }
  }
}
```

## Copy a starter file

Ready-to-copy files for each JSON layer:

- [`config.global.example.json`](../skills/brigade/templates/config.global.example.json)
- [`config.team.example.json`](../skills/brigade/templates/config.team.example.json)
- [`config.local.example.json`](../skills/brigade/templates/config.local.example.json)

## Validate before you commit

```bash
brigade-config doctor
```

`doctor` catches unparseable JSON, unknown top-level keys, bad enum values (`tier`,
`policy.planCheck`, context-source `type`), a `maxParallel` that is not a positive integer,
a non-boolean `workingMemory`, out-of-range `budgets`, a haiku-class reviewer, `kb.enabled`
with no `kb.cli`, duplicate or id-less context sources, `static-file` sources whose path does
not exist, and every bad red-team, PR template or writing setting. It exits 1 when anything
is wrong, so it works in a pre-commit hook or CI. It also prints advisory notes that never
fail, such as a resolved tier of three-star.
