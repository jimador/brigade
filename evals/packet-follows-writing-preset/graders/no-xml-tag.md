---
# Fails when the packet holds an XML-style tag (<context>, </example>, <doc id="1">) or a
# chat-template token (<|im_start|>, [INST]). A regex cannot see code fences, so a tag inside
# a fenced block would also fail it; the prompt keeps fences out of the Steps for that reason.
# Generics such as Array<string> and a tag right after a backtick (`<div>`) are not counted.
# An unfilled placeholder such as wip/<item-slug> does count: a finished packet has none.
type: regex
pattern: '(?<![\w$`])</?[A-Za-z][\w.-]*(?:\s+[\w:-]+=(?:"[^"\n]*"|''[^''\n]*''))*\s*/?>|<\|[^|\n]{1,40}\|>|\[/?INST\]'
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
