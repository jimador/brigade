# Configuration and prompt overrides

Read when: resolving settings at dish start; passing overrides into a workflow script; a
`doctor` failure.

Settings are resolved mechanically, never by reading the files. `brigade-config` does the
merge at zero model tokens; the Planner consumes its output.

## Layers

Settings come from four layers, later winning key by key: built-in defaults →
`~/.brigade/config.json` (global personal) → `<repo>/brigade.config.json` (team,
committed) → `<repo>/.brigade/config.local.json` (repo personal). `.brigade/config.md`
stays the **board wiring** (source, board id, identity, status mapping, gate commands); the
JSON layers carry **fleet behavior** and win where both express the same thing.

## Resolve once per dish

Three commands, zero model tokens: `resolve --json` (merged settings and the layer that set
each key), `prompts --json` (prompt-override stacks by role), `doctor` (validate every layer;
exit 1 on problems).

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" resolve --json
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" prompts --json
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" doctor
```

Pass the resolved settings into the Workflow scripts as `overrides` and the prompt stacks
as `promptOverrides` (Phases 1 and 3–5). `overrides` is the `config` object from
`resolve --json`; passing the whole resolve output also works — the scripts unwrap
`.config`. The scripts fold them over the tier policy themselves — cook/inspector/steward
agent types, `scoutCap`, `maxParallel`, and the circuit-breaker thresholds are all
overridable without editing any script.

`models.<role>` points a role at a different agent type; `null` keeps the shipped agent.
The cook ladder has three slots:

| key | rung | default |
| --- | --- | --- |
| `cook` | first attempt at ★★ and ★ | `brigade:brigade-cook` |
| `cookRetry` | retry after an inspector FAIL at ★★ and ★ | the same agent as `cook` |
| `cookHeavy` | heavy rung everywhere; every ★★★ attempt | `brigade:brigade-cook-heavy` |

Set `cookRetry` to a stronger agent when the retry should escalate instead of rerunning
the first model. The `cook` prompt override stack applies to every cheap rung, retry
included.

A `doctor` failure is a readiness failure: fix it, or tell the user exactly which file and
key, before dispatching. The SessionStart hook already ran `layers` + `doctor`.

## Context sources and the knowledge base

Context sources merge by `id` across the same layers, so a later layer retunes or disables
one without restating the list. Types: `static-file`, `mcp`, `skill`, `command`
(`localOnly`). Every source soft-fails. Write the digest to
`.brigade/dishes/<slug>/CONTEXT.md` at dish or design start.

Knowledge base — if the resolved `kb.enabled` is true and `kb.cli` is on PATH, run it with
the configured `search_args` / `ingest_args`; otherwise skip silently. Never hard-require a
specific vendor CLI.

## Prompt overrides

Settings replace values; prompt overrides **stack**. Every layer with text for a role
contributes, appended after the shipped prompt in layer order:

- `~/.brigade/overrides/{agents,prompts}/<role>.md` — global personal
- `<repo>/.brigade-overrides/{agents,prompts}/<role>.md` — team, committed
- `<repo>/.brigade/overrides/{agents,prompts}/<role>.md` — repo personal
- config `prompts.<role>.append` — short inline additions

Roles: `scout`, `cook`, `cookHeavy`, `inspector`, `analyst`, `design`, `designer`,
`steward`, `planner`. Resolve with `brigade-config prompts --json` at dish start and pass
the result through; agents never read override files themselves. Your own `planner`
stack is the exception: nothing dispatches the Planner, so SessionStart inlines it into
the session. If that block is missing, run `brigade-config prompt planner` yourself at
dish start and follow it.

Overrides only ADD instructions. They never remove the Inspector gate, the Analyst pass,
or the evidence requirements — forking the agent file is the honest way to do that.

## Writing rules

The `writing` block says how each artifact is written. It goes in any JSON layer:

```json
{ "writing": { "preset": "ste-80", "rules": { "ticket_comment": ["Write at most five sentences."] }, "checks": { "packet": { "terms": { "work item": ["task", "slice"] } } } } }
```

- `preset`: `none` (the default) or `ste-80`, the sentence rules in `writing/ste-80.md` that
  the Planner writes packets to. A later layer replaces it.
- `rules.<artifact>`: plain sentences for whoever writes that artifact. Rules **stack** like
  prompt overrides: every layer's list is appended in layer order, and no layer removes one.
- `checks.<artifact>`: what a script can check; only `packet` has checks. Checks **replace**
  key by key, `terms` whole; `0` or `false` turns a preset's check off. `terms` maps the one
  approved term to the words that must not stand in for it.

Artifacts: `packet`, `plan`, `brief`, `report`, `verdict`, `ticket_comment`, `pr_body`.
Resolve once per dish with `brigade-config writing --json`, which prints
`{ preset, presetFile, rules, checks }`. Each rule set goes only to the agent that writes
that artifact: `report` to the cook, `verdict` to the inspector, `brief` to the scout, and
`packet`, `plan`, `ticket_comment`, `pr_body` to you. An agent never pays context for rules
it does not use, and never follows rules meant for another artifact.

## Red team and PR template

Two blocks drive the handoff red team and the PR description (`HANDOFF.md` § 3 and § 4).
Both go in any JSON layer. Objects merge key by key. Lenses, severities, sections and
`prTemplate.validation` merge by `id`: a later entry patches the one with its id,
`"enabled": false` switches it off, and a new id is appended.

```json
{
  "review": { "redTeam": {
    "lenses": [{ "id": "concurrency", "enabled": false },
               { "id": "migrations", "title": "Migrations", "lens": "Stored data a deploy leaves half moved." }],
    "reviewerOrder": ["claude", "codex"],
    "reviewers": { "cursor": { "enabled": false } }
  } },
  "prTemplate": {
    "sections": [{ "id": "screenshots", "enabled": false }],
    "validation": [{ "id": "e2e", "run": "npm run e2e", "paths": ["web/**"] }],
    "uiPaths": ["web/src/**"],
    "size": { "maxChangedLines": 600 }
  }
}
```

`review.redTeam`:

- `required`: `true` (default) makes a clean verdict or a human override a condition of a
  ready PR. `false` makes the review advisory; the PR may record n/a with a reason.
- `lenses`: what the find pass hunts for. Seven by default: `correctness`, `failure`,
  `security`, `concurrency`, `compatibility`, `tests`, `scope`. Each is `{ title, lens }`.
- `severities`: `error` blocks, `warning` is fixed or recorded as a decision, `note` is advice.
- `findingFormat` (`compiler` or `plain`) and `ruleNamespace` shape each finding line.
- `reviewerOrder` and `reviewers.<tool>`: `{ name, bin, find, verify, enabled }`. `bin` is
  looked up on PATH; a tool that is not installed is skipped. Commands take `{base}`,
  `{head}`, `{brief}` and `{findings}`; `verify` must take `{findings}`. The default find
  commands for Codex and Claude Code use their own reviewers and do not read the brief, so
  custom lenses reach the find pass only through a command that reads `{brief}`, such as
  `codex exec "Find pass. Read {brief}, then review git diff {base}...{head} through every lens in it." < /dev/null`.

`prTemplate`:

- `sections`: `{ title, kind, required, requiredWhen, hint }`; `kind` is `text`, `stack`,
  `validation`, `screenshots` or `review`; `requiredWhen: "ui"` requires it only for a UI
  change. The `stack` and `validation` sections, and `review` while the red team is
  required, cannot be switched off or made optional.
- `validation`: `{ run, required, paths }` per command whose output the PR must carry; a
  command with `paths` is required only when a changed file matches. Empty means every
  `gate` command is required.
- `uiPaths`: globs; a change to a match needs screenshots.
- `size`: `maxChangedLines` (400), `maxStackDepth` (5), `enforce` (`error` or `warning`),
  `exclude` (globs not counted).

`brigade-pr` reads both through `brigade-config` and refuses to run while `doctor` reports a
problem in either.
