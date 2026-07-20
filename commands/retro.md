---
description: Run the brigade analyst retro on a dish (mandatory at handoff; intensive at three-star)
argument-hint: [dish-slug] [--standard|--intensive]
---

Arguments: $ARGUMENTS

Resolve the dish: the argument if given, else the single dish under `.brigade/dishes/`
with items not all done, else ask. Resolve the mode: an explicit `--intensive` or
`--standard` flag wins; otherwise intensive when the dish tier (PLAN.md `tier:`, falling
back to `brigade-config get tier`) is `three-star` and this is an end-of-dish retro,
standard otherwise (mid-dish checkpoints are always standard).

Standard: dispatch `brigade-analyst` exactly per the self-improvement section of the
brigade skill: pass the dish dir, `.brigade/LEARNINGS.md`, and the output path
`.brigade/dishes/<dish>/analyst.md`; paste the `analyst` schema block from `SCHEMAS.md`
into its prompt.

Intensive: same dispatch, plus — model override `opus`, `mode: intensive` stated in the
prompt, and the cross-dish inputs: every prior `.brigade/dishes/*/analyst.md`, the
efficiency block from `brigade-status`, and the live heuristic set (the KB search command
from `~/.brigade/config.json` when `kb.enabled`, else `.brigade/LEARNINGS.md`
`## Heuristics` plus the committed heuristics file).

When the report lands, apply repo-local learnings to `.brigade/LEARNINGS.md` and offer
any generalizable heuristic to the KB (one yes/no). After an intensive retro also: retire
proposals the ledger ruled dead (KB amend or heuristics-file status), surface ignored
ones to the user, and present `tooling` proposals as operator decisions — never
auto-install anything.
