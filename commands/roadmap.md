---
description: Roadmap an initiative — grill the intent, inventory the systems, propose epics, drill down in confirmed rounds; never claim or cook
argument-hint: "[slug] [resume|refresh]"
---

# /brigade:roadmap

Arguments: $ARGUMENTS

Run a **roadmap session** (not a cook).

1. Read `roadmap_dir` from the `## Repo` section of `.brigade/config.md` (default
   `.brigade/roadmaps`) once, here at the start. Resolve the slug (argument, or list
   `<roadmap_dir>/*/` and ask). The roadmap folder is `<roadmap_dir>/<slug>/`; use that
   everywhere, never a hard-coded path.
2. Load `skills/roadmap/SKILL.md` and follow it.
3. Acquire `roadmap-<slug>` as `claude` with `brigade-coord` before the first write; release
   it before every confirmation stop and before you finish.
4. No `ROADMAP.md` yet → start at the skill's **Intent** step. `ROADMAP.md` exists, or the
   argument says `resume` → run its **Resume** (replay any approved batch first). `refresh` →
   run its **Roll-up** and report, no drilling.
5. **Do not** claim tickets, set `worker`, write work packets, or dispatch cooks.

When done, print: nodes drilled, leaves ready and published, open questions by name, coverage
gaps, and the path to `roadmap.html`.
