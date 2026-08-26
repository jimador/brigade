---
description: UI design loop for a front-end ticket — stand up the app or a canvas, iterate live in the browser, capture agreed states as UI samples, leave the ticket implementer-ready; never claim or cook
argument-hint: [ticket-id] [state-name]
---

# /brigade:ui

Run the **Designer loop** in this session (not a cook).

1. Resolve the ticket id (argument, or ask) and its `repo`. If cwd is a workspace root,
   search member boards under `~/vault/tickets/<workspace>/` (see `~/.brigade/workspaces.md`).
2. Load `agents/brigade-designer.md` + `skills/brigade/SKILL.md` § UI design loop, and the
   source adapter's § UI samples (`skills/brigade/sources/<adapter>.md`).
3. Derive the dish slug (`brigade-coord key`), acquire it as `claude`, create
   `.brigade/dishes/<slug>/prototypes/` if missing.
4. Run the loop here — the browser and design tools are this session's. A state name as the
   second argument resumes iteration on that state. Subagents only for assets, documenter,
   and manual-edit application. Release the lease before stopping.
5. **Do not** claim as a cook, set `worker`, decompose, or dispatch cooks. Status moves to
   `todo` only when the operator says the ticket is ready.

When done, print: states captured (by name) with sample paths, whether assets were
produced, ticket status.
