---
description: Run the brigade analyst retro on a dish (mandatory at handoff; cheap mid-dish checkpoint)
argument-hint: [dish-slug]
---

Arguments: $ARGUMENTS

Resolve the dish: the argument if given, else the single dish under `.brigade/dishes/`
with items not all done, else ask. Then dispatch `brigade-analyst` exactly per the
self-improvement section of the brigade skill: pass the dish dir, `.brigade/LEARNINGS.md`,
and the output path `.brigade/dishes/<dish>/analyst.md`; paste the `analyst` schema block
from `SCHEMAS.md` into its prompt. When the report lands, apply repo-local learnings to
`.brigade/LEARNINGS.md` and offer any generalizable heuristic to the KB (one yes/no).
