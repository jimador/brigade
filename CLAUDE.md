@AGENTS.md

## Claude Code

- Marketplace installs are cached copies. After editing anything the plugin ships (skills,
  agents, hooks, commands, workflows, output styles, `settings.json`, `scripts/`): bump `version`
  in `.claude-plugin/plugin.json`, then run `claude plugin update brigade@brigade`. Until then,
  sessions keep running the old copy — the most common reason a change appears to do nothing.
- Every version bump adds a `### <version>` entry at the top of the ledger in
  `skills/onboard/UPGRADES.md`, with `touches: none` when open tickets and dishes need no edit,
  or a content-based `find` and a `change` when they do. `test/regression.sh` fails when the
  newest entry is not the manifest's version.
- `claude plugin validate .claude-plugin/plugin.json` is part of the gate. Do not add `--strict`
  here: this file draws an intentional warning (contributor context, not shipped context).
- Retro heuristics land in a knowledge base when `~/.brigade/config.json` sets `kb.enabled` and
  `kb.cli`, otherwise in `.brigade/LEARNINGS.md`; teams may commit them to
  `skills/brigade/policies/heuristics.md`. A brain-upgrade pass (`skills/brigade/RETRO.md`)
  absorbs them into the skill and agent text and retires each absorbed note.
