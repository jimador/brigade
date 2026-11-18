---
# The judge reads only the final reply. The fixture repo has no agent-instructions file, so a
# good plan proposes creating AGENTS.md rather than reporting one it found, and the run has no
# AskUserQuestion tool, so it asks for approval in plain text.
type: llm
---

PASS if the response lays out a setup plan before writing anything: it names the pieces it
would set up, covering at least `.brigade/config.md` and an agent-instructions section (for
example a new AGENTS.md), as a table or a list, and it ends by asking the user to approve the
plan or answer questions first. Mentioning what it detected (main branch, a test command such
as `npm test`, no instructions file yet) counts in its favour but is not required.
FAIL if it says it has already created or written `.brigade/config.md`, AGENTS.md or another
setup file, if it presents no plan, or if it does not ask before going ahead.
