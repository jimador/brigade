---
type: llm
focus: { source: file, path: comment.md }
---

The file is a handoff comment for a ticket. Count its sentences: a list item, a table row or
a line of text that ends without a full stop counts as one sentence each, and a heading does
not count.

PASS if the comment holds at most five sentences and still says what changed.
FAIL if the file is missing or empty, if it holds six sentences or more, or if it does not
say what changed. Give the count.
