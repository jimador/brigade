---
type: regex
pattern: 'status: in_progress'
match: not_contains
target: { source: file, path: .brigade/board/rate-limit-login.md }
---
