---
# Fails when the comment was posted to the ticket file instead of only written to comment.md.
# The fixture's ticket never contains "Outcome:", so a match means the planner appended it.
type: regex
pattern: 'Outcome:'
match: not_contains
target: { source: file, path: .brigade/board/trim-display-name.md }
---
