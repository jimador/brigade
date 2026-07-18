---
description: One-shot Design swag for a ticket — research, open questions, leave in design; never claim or cook
---

# /brigade:design

Run a **Design swag** (not a cook).

1. Resolve the ticket id (argument, or ask). If cwd is a workspace root, search member boards
   under `~/vault/tickets/<workspace>/` (see `~/.brigade/workspaces.md`).
2. Load `agents/brigade-design.md` + `skills/brigade/SKILL.md` § Design swag.
3. Create `.brigade/dishes/<slug>/` under the ticket's `repo` (or workspace fallback) if
   missing. Stub `DESIGN.md` with `doc: design_swag` if absent.
4. Execute the Design pass: scouts → DESIGN.md → board comment + status `design`.
5. **Do not** claim, set `worker`, decompose, or dispatch cooks.

When done, print: readiness verdict, top open questions, path to DESIGN.md.
