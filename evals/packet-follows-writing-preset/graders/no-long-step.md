---
# Fails when a numbered step in the packet holds a sentence of more than 20 words. A regex
# sees one file and no Markdown structure, so this is an approximation: it reads a numbered
# line plus its indented continuation lines as one step, skips sentences that end in . ! or ?
# before the long one, and ignores bullets, sub-bullets and everything outside numbered lists.
# Preconditions & hazards are bullets, so the llm rubric covers their sentence length.
type: regex
pattern: '^[ \t]*\d+\.[ \t]+(?:(?:[^\n]|\n(?=[ \t]+\S)(?![ \t]+(?:[-*+]|\d+[.)])[ \t]))*?[.!?](?:[ \t]*\n(?=[ \t]+\S)(?![ \t]+(?:[-*+]|\d+[.)])[ \t])[ \t]+|[ \t]+))?(?:\S*[^\s.!?](?:[ \t]*\n(?=[ \t]+\S)(?![ \t]+(?:[-*+]|\d+[.)])[ \t])[ \t]+|[ \t]+)){20}\S'
flags: m
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
