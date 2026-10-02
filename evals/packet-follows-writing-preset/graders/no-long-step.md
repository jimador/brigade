---
# Fails when a numbered line in the packet holds a sentence of more than 20 words: 21 words
# in a row with no sentence end among the first 20. A word ends a sentence when it ends with
# `.`, `?`, `!` or `:`, with closing marks (`*`, a backtick, a quote, `)`, `]`) allowed after
# it, so a label such as **Explore:** and two short sentences on one line pass. It starts at
# the file start or a line break (no `m` flag needed) and counts across spaces and tabs only,
# so a count never runs onto the next line. Two limits: it reads only the numbered line, not
# the lines that continue the step, and an abbreviation with a full stop (e.g.) ends a
# sentence early.
type: regex
pattern: '(?:^|\n)[ \t]*\d+\.[ \t][^\n]*?(?<![^ \t])(?:(?![^ \t\n]*[.?!:][*`"'')\]]*(?=[ \t\n]|$))[^ \t\n]+[ \t]+){20}[^ \t\n]'
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
