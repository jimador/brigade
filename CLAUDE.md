@AGENTS.md

## Claude Code

- Marketplace installs are cached copies. After editing anything the plugin ships (skills,
  agents, hooks, commands, workflows, output styles, `settings.json`, `scripts/`): bump `version`
  in `.claude-plugin/plugin.json`, then run `claude plugin update brigade@brigade`. Until then,
  sessions keep running the old copy — the most common reason a change appears to do nothing.
- `claude plugin validate .claude-plugin/plugin.json` is part of the gate. Do not add `--strict`
  here: this file draws an intentional warning (contributor context, not shipped context).
- Retro heuristics land in a knowledge base when `~/.brigade/config.json` sets `kb.enabled` and
  `kb.cli`, otherwise in `.brigade/LEARNINGS.md`; teams may commit them to
  `skills/brigade/policies/heuristics.md`. A brain-upgrade pass (`skills/brigade/RETRO.md`)
  absorbs them into the skill and agent text and retires each absorbed note.
