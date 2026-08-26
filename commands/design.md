---
description: Design swag for a ticket — first pass writes the decision ledger, a revisit resolves one open question; never claim or cook
argument-hint: [ticket-id] [question-name]
---

# /brigade:design

Run a **Design swag** (not a cook).

1. Resolve the ticket id (argument, or ask). If cwd is a workspace root, search member boards
   under `~/vault/tickets/<workspace>/` (see `~/.brigade/workspaces.md`).
2. Load `agents/brigade-design.md` + `skills/brigade/SKILL.md` § Design swag.
3. Derive the dish slug (`brigade-coord key`), acquire it as `claude`, create
   `.brigade/dishes/<slug>/` under the ticket's `repo` (or workspace fallback) if missing.
4. No `DESIGN.md` → run the agent's **First pass**. `DESIGN.md` exists → run its **Revisit**
   on the named question, else the first unblocked one. Release the lease before stopping.
5. **Do not** claim, set `worker`, decompose, or dispatch cooks.

When done, print: readiness verdict, the question resolved (by name) or the top open
questions, path to DESIGN.md.
