# Configuration

Brigade reads settings from four layers. Later layers win, key by key, so you can change
one thing without restating everything above it.

| # | Layer | File | Committed? | Scope |
| --- | --- | --- | --- | --- |
| 1 | defaults | built into `bin/brigade-config` | — | what brigade does with no config at all |
| 2 | global | `~/.brigade/config.json` | no | you, every repo |
| 3 | team | `<repo>/brigade.config.json` | **yes** | everyone in this repo |
| 4 | local | `<repo>/.brigade/config.local.json` | no | you, this repo |

The layer that set each value is always recoverable:

```bash
brigade-config resolve          # merged settings, with the winning layer per key
brigade-config layers           # which layer files exist, in precedence order
brigade-config get tier         # one value
brigade-config doctor           # validate every layer
```

`brigade-config` costs no model tokens. Prefer it over asking Claude to read config files.

## Board configuration is separate

Two files, two jobs. `.brigade/config.md` (markdown, per repo, uncommitted) holds the
**board wiring** — which ticket source, which board id, your identity on it, the status
name mapping, and the repo's verification gate. It is written by the init interview on
first run.

The JSON layers above hold **fleet behavior** — tier, models, parallelism, thresholds,
context sources, prompt overrides. They are optional; brigade runs without any of them.

Where both can express the same thing (tier, gate commands), the JSON layers win, because
they are the ones that cascade.

## Settings

### Fleet shape

```json
{
  "tier": "two-star",
  "mainBranch": "main",
  "maxParallel": 4,
  "gate": ["bun run types", "bun test"],
  "worktreeRoot": null,
  "remotePr": true
}
```

- `tier` — `three-star` | `two-star` | `one-star`. Sets model spend per dish; see
  [tiers.md](tiers.md). A spoken override ("brigade heavy") beats the config for one dish.
- `mainBranch` — the line delivery branches are cut from.
- `maxParallel` — how many cooks run at once. Lower it on a laptop or a slow test suite.
- `gate` — the verification commands every cook must run and paste real output from.
- `worktreeRoot` — where item worktrees go. `null` means `<repo>/.brigade/worktrees`.
  Set it when the repo lives on a slow or size-capped volume.
- `remotePr` — `false` means handoff stops at a local integration branch instead of a PR.

### Policy

```json
{
  "policy": {
    "scoutCap": null,
    "planCheck": "always",
    "retro": null,
    "heavyShareWarn": 0.2
  }
}
```

`null` means "take the tier's value". Set one explicitly to decouple it from the tier —
for example, keep cheap cooks but always run the adversarial plan check on a repo where a
bad decomposition is expensive.

- `scoutCap` — max scouts dispatched per research round.
- `planCheck` — `always` | `triggers` | `never`.
- `retro` — how often the analyst pass runs.
- `heavyShareWarn` — the fraction of `heavy` items above which the decomposition is
  probably too coarse.

### Agents per role

```json
{
  "models": {
    "scout": null,
    "cook": null,
    "cookHeavy": null,
    "inspector": null,
    "analyst": null,
    "design": null,
    "steward": null
  }
}
```

Each key takes an **agent type** — the name the Agent tool dispatches, such as
`brigade:brigade-cook` or one of your own agents. `null` keeps the shipped brigade agent.
This is the seam for swapping in a team-specific reviewer, a domain-trained cook, or a
cheaper steward, without editing the workflow scripts.

The escalation ladder still comes from the tier; these keys only decide *which agent*
fills each rung.

### Circuit breaker

```json
{
  "circuitBreaker": { "maxLadderExhausts": 2, "maxTotalFails": 4 }
}
```

How much failure the run absorbs before it stops and hands back to you. Repeated failures
usually mean the plan's premises were wrong, so the defaults are deliberately impatient.
Raise them only when you know the suite itself is flaky.

### Graphite

```json
{ "graphite": { "restack": false, "platform": false } }
```

Both off by default. See [`skills/brigade/GRAPHITE.md`](../skills/brigade/GRAPHITE.md).

### Knowledge base

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

Optional. If `enabled` is true and `cli` is on PATH, brigade runs it to pull cross-repo
heuristics at dish start and to file new ones at retro. If the CLI is missing, brigade
skips it silently — no vendor is ever required. Without a KB, heuristics accumulate in
`.brigade/LEARNINGS.md` and, for teams, `skills/brigade/policies/heuristics.md`.

### Context sources

Portable prior art pulled in before decomposition. Merged **by `id`**, so a later layer
can retune or disable a source without restating the list.

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

- `type` — `static-file` | `mcp` | `skill` | `command`.
- `enabled` — `false` in a later layer switches off a source an earlier layer added.
- `localOnly` — never used by agents that run outside your machine.
- `preflight` — which phases pull this source.

Every source soft-fails: an unreachable MCP server or a missing file is logged, not fatal.

`review.dimensions` follows the same merge-by-`id` shape for `/brigade:review`'s eight
review lenses (`correctness`, `tests`, `architecture`, `maintainability`, `reuse`,
`duplication`, `security`, `product`): `{ "review": { "dimensions": [{ "id": "security",
"enabled": false }] } }` disables a built-in dimension, patching other fields (`title`,
`lens`) retunes it, and an `id` not in the built-in set is appended as a custom dimension.

### Prompt overrides

Short additions inline; anything longer goes in a file. Both are covered in
[overrides.md](overrides.md).

```json
{
  "prompts": {
    "cook": { "append": ["Never reformat lines the packet did not ask you to change."] }
  }
}
```

## Examples

Ready-to-copy files for each layer:

- [`skills/brigade/templates/config.global.example.json`](../skills/brigade/templates/config.global.example.json)
- [`skills/brigade/templates/config.team.example.json`](../skills/brigade/templates/config.team.example.json)
- [`skills/brigade/templates/config.local.example.json`](../skills/brigade/templates/config.local.example.json)

## Validation

```bash
brigade-config doctor
```

Catches unparseable JSON, unknown top-level keys, bad enum values (`tier`,
`policy.planCheck`, context-source `type`), a non-positive `maxParallel`, `kb.enabled`
with no `kb.cli`, duplicate or id-less context sources, and `static-file` sources whose
path does not exist. It exits 1 when anything is wrong, so it works in a pre-commit hook
or CI.
