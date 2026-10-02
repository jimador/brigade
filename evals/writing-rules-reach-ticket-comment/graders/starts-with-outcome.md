---
# Fails unless comment.md opens with "Outcome:" (bold markers around the word are allowed).
# No `m` flag, so ^ is the start of the file, not of any line.
type: regex
pattern: '^\s*(?:\*\*|__)?Outcome:'
target: { source: file, path: comment.md }
---
