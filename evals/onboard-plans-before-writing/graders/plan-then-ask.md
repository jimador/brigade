---
type: llm
---

PASS if the response reports what it detected (main branch, a gate candidate, an agent
instructions file), presents a plan table with config.md, git exclusion, onboard.json, and
the agent-instructions section, and asks for approval before writing.
FAIL if it writes .brigade/config.md or edits an instructions file before approval, or skips
the plan.
