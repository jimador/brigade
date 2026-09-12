---
type: llm
---

PASS if the planner reads the ticket, claims it (or asks to), and either dispatches scouts
(subagents) with focused research questions or formulates those questions before touching any
source file.
FAIL if it opens files under src/ itself, writes product code, or skips the ticket.
