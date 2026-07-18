# Prompt and agent overrides

Config settings replace values. Prompt overrides **stack**: every layer that has text for
a role contributes, appended in layer order, after the shipped prompt. A repo can tighten
a global rule without losing it, and nothing you write can delete a shipped rule.

That last part is deliberate. Overrides add instructions; they never remove the Inspector
gate, the Analyst pass, or the evidence requirements. If you need those gone, fork the
agent files — don't paper over them with an override.

## Where the files go

| Layer | Agent overrides | Prompt overrides | Committed? |
| --- | --- | --- | --- |
| global | `~/.brigade/overrides/agents/<name>.md` | `~/.brigade/overrides/prompts/<name>.md` | no |
| team | `<repo>/.brigade-overrides/agents/<name>.md` | `<repo>/.brigade-overrides/prompts/<name>.md` | **yes** |
| local | `<repo>/.brigade/overrides/agents/<name>.md` | `<repo>/.brigade/overrides/prompts/<name>.md` | no |

`<name>` is a role: `scout`, `cook`, `cookHeavy`, `inspector`, `analyst`, `design`,
`steward`, or `planner`.

The `agents/` and `prompts/` split is organizational, not functional — both stack into the
same resolved text. Use `agents/` for durable role instructions and `prompts/` for
task-shaped nudges if the distinction helps you; brigade does not care.

## Inspecting the stack

```bash
brigade-config prompts          # every override, in the order it applies
brigade-config prompt cook      # the resolved text for one role, with layer markers
```

Example:

```
## prompt overrides (applied in this order, appended to the shipped text)
  cook:
    global  /home/you/.brigade/overrides/agents/cook.md (6 lines)
    team    /path/to/acme/web/.brigade-overrides/agents/cook.md (11 lines)
    config  (inline in config) (1 lines)
```

## Inline additions

One or two sentences do not deserve a file:

```json
{
  "prompts": {
    "inspector": {
      "append": ["Treat a missing test for a bug fix as a blocking finding, not a nit."]
    }
  }
}
```

Inline fragments apply after file overrides from the same layer.

## Writing a good override

Overrides are appended to a prompt that already has rules, so write them as **additional
constraints**, not as a new brief.

Good:

```markdown
This repo's HTTP handlers are generated. Never edit files under `src/generated/` —
change the schema in `schema/` and note in your report that regeneration is required.
```

Bad — restates what the shipped prompt already says, and burns tokens on every dispatch:

```markdown
You are a cook. Implement exactly one work packet. Stay inside the file list. Run the
verification gate and paste the output...
```

Keep each override under about 20 lines. Every line is re-sent on every dispatch of that
role, so a bloated override is a per-item tax on a run that may dispatch dozens of agents.

## How it reaches the agents

The Planner resolves the stack once at dish start and passes it to the workflow scripts as
`promptOverrides`, keyed by role. `brigade-execute` and `brigade-research` append the
fragments to each dispatch. Agents never read the override files themselves — resolution
happens once, so a mid-run edit to an override file does not change agents already in
flight.

## Precedence recap

```
shipped agent/skill text
  + ~/.brigade/overrides/…            (global, yours)
  + <repo>/.brigade-overrides/…       (team, committed)
  + <repo>/.brigade/overrides/…       (local, yours, this repo)
  + config `prompts.<role>.append`    (same layer order)
```

Specificity wins for settings; for prompts, everything applies.
