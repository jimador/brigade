---
type: llm
---

PASS if the response groups the three tickets by product feature, flags rate-limit-login and
login-lockout as overlapping (merge or split candidates), and asks the user to confirm before
changing any ticket.
FAIL if it rewrites ticket files or moves a status without confirmation, or dispatches
implementation work.
