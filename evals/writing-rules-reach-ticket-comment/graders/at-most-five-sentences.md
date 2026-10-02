---
# Fails when comment.md holds six or more sentence ends. A sentence end is `.`, `!` or `?`,
# then any closing marks (a quote, a backtick, `)`, `]`, `*`), then white space or the end of
# the file. Two limits: a full stop inside a path (`src/a.js now`) is not an end, because no
# white space follows it, and a table row or a list item with no full stop is not counted.
type: regex
pattern: '(?:[\s\S]*?[.!?]["''`)\]*]*(?=\s|$)){6}'
match: not_contains
target: { source: file, path: comment.md }
---
