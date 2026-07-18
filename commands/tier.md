---
description: Show or set the brigade service tier (three-star | two-star | one-star)
argument-hint: [three-star|two-star|one-star]
allowed-tools: Read, Edit, Bash(brigade-status:*)
disable-model-invocation: true
---

Arguments: $ARGUMENTS

- No argument → read `.brigade/config.md`, report the active tier (absent key =
  two-star default) and its one-line meaning from the plugin's
  `skills/brigade/TIERS.md` table.
- A valid tier → update (or insert, under `- main_branch:` in `## Repo`) the line
  `- tier: <value>` in `.brigade/config.md`, then confirm old → new. Touch no other line.
- Anything else → list the three valid tiers; change nothing.
