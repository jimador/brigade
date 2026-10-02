---
# Fails when a numbered line in the packet holds more than 20 words. A regex sees one file
# and no sentences, so this stands in for "a step sentence of more than 20 words". It starts
# at the file start or a line break (no `m` flag needed) and counts words only with spaces and
# tabs, so a word count never runs onto the next line. It misses a long step wrapped over
# several lines, and it trips on one line that holds two short sentences.
type: regex
pattern: '(?:^|\n)[ \t]*\d+\.[ \t]+(?:\S+[ \t]+){20,}\S'
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
