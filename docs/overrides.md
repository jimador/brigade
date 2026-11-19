---
title: Prompt overrides
description: Add your own instructions to any Brigade role, per person or per team, without forking the agents.
---

Prompt overrides let you add instructions to a role, such as "never edit generated files" for
every cook, without editing the shipped agents. This page shows where the files go, how they
stack, and how to check what each role actually receives.

## Overrides add, they never remove

Config settings replace values. Prompt overrides stack: every layer that has text for a role
contributes, appended in layer order after the shipped prompt. A repo can tighten a global
rule without losing it, and nothing you write can delete a shipped rule.

That is deliberate. Overrides never remove the inspector gate, the analyst pass or the
evidence requirements. If you need those gone, fork the agent files instead.

## Put the file in the right place

| Layer | Agent overrides | Prompt overrides | Committed? |
| --- | --- | --- | --- |
| global | `~/.brigade/overrides/agents/<role>.md` | `~/.brigade/overrides/prompts/<role>.md` | no |
| team | `.brigade-overrides/agents/<role>.md` | `.brigade-overrides/prompts/<role>.md` | yes |
| local | `.brigade/overrides/agents/<role>.md` | `.brigade/overrides/prompts/<role>.md` | no |

Team and local paths are relative to the repo root. `<role>` is one of `scout`, `cook`,
`cookHeavy`, `inspector`, `analyst`, `design`, `designer`, `steward` or `planner`.

The `cook` stack applies to every cheap rung of the ladder, the retry included. `cookHeavy`
applies to the heavy cook.

The `agents/` and `prompts/` split is for your own organization: both stack into the same
resolved text. Use `agents/` for durable role instructions and `prompts/` for task-shaped
nudges if the distinction helps you.

## Check what a role receives

```bash
brigade-config prompts          # every override, in the order it applies
brigade-config prompt cook      # the resolved text for one role, with layer markers
```

Example output:

```text
## prompt overrides (applied in this order, appended to the shipped text)
  cook:
    global  ~/.brigade/overrides/agents/cook.md (6 lines)
    team    /path/to/repo/.brigade-overrides/agents/cook.md (11 lines)
    config  (inline in config) (1 lines)
```

## Add a sentence inline

One or two sentences do not deserve a file. Put them in any JSON config layer:

```json
{
  "prompts": {
    "inspector": {
      "append": ["Treat a missing test for a bug fix as a blocking finding, not a nit."]
    }
  }
}
```

Inline fragments apply after the file overrides from the same layer.

## Write a good override

Overrides are appended to a prompt that already has rules, so write them as extra
constraints, not as a new brief.

Good:

```markdown
This repo's HTTP handlers are generated. Never edit files under `src/generated/`.
Change the schema in `schema/` and note in your report that regeneration is required.
```

Bad, because it restates the shipped prompt and burns tokens on every dispatch:

```markdown
You are a cook. Implement exactly one work packet. Stay inside the file list. Run the
verification gate and paste the output...
```

Keep each override under about 20 lines. Every line is re-sent on every dispatch of that
role, and a run may dispatch dozens of agents.

## How overrides reach the agents

The Planner resolves the stack once at dish start with `brigade-config prompts --json` and
passes it to the workflow scripts as `promptOverrides`, keyed by role. The execute, research
and review workflows append the text to each dispatch. Agents never read the override files
themselves, so editing an override mid-run does not change agents already in flight.

The `planner` stack is the exception, because nothing dispatches the Planner: the SessionStart
hook inlines it into the session. If that block is missing, the Planner runs
`brigade-config prompt planner` itself at dish start.

## Precedence at a glance

```text
shipped agent or skill text
  + ~/.brigade/overrides/...          (global, yours)
  + .brigade-overrides/...            (team, committed)
  + .brigade/overrides/...            (local, yours, this repo)
  + config prompts.<role>.append      (same layer order)
```

For settings, the most specific layer wins. For prompts, everything applies.
