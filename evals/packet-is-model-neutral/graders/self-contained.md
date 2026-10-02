---
type: llm
focus: { source: file, path: .brigade/dishes/sample/packet.md }
---

The file is a work packet that a language model with no other context will execute.

PASS only if all of these hold:
1. It is self-contained: the files to touch, the code it must fit, and the exact commands
   to run are written in the file. It does not send the reader elsewhere for them ("see the
   ticket", "as in the plan", "per the brief", a skill or a template named as the source).
2. It states its output plainly: which files the reader creates or changes, what result
   proves the work is done, and where the reader puts its result or report.
3. It is plain Markdown: headings, lists and fenced code, with no XML-style tags and no
   instructions addressed to one particular product, model or tool.

FAIL if the file is missing or empty, or if any check above fails. Quote the passage that
fails a check.
