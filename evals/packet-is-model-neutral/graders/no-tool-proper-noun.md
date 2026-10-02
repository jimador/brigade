---
# Fails when the packet names an agent tool as a proper noun ("the Read tool", "the `Grep`
# tool") or by its runtime id (mcp__server__tool). Another runtime has other tools; the packet
# says the action instead ("read the file"). Lowercase verbs and code in backticks pass.
type: regex
pattern: '\b(?:Read|Write|Edit|MultiEdit|NotebookEdit|Grep|Glob|LS|Bash|Task|Agent|Skill|WebFetch|WebSearch|TodoWrite)`?\s+tools?\b|\bmcp__\w+'
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
