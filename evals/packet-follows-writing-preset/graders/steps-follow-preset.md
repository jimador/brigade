---
type: llm
focus: { source: file, path: .brigade/dishes/sample/packet.md }
---

The file is a work packet written under a writing preset. Read its `### Steps` and
`### Preconditions & hazards` sections, then its `### Acceptance criteria` and
`### Contracts you code against` sections.

PASS only if all of these hold:
1. No sentence in Steps or in Preconditions & hazards gives two instructions. A sentence
   that joins two actions with "and", "then" or a semicolon fails this. A sentence may
   state a fact instead of an instruction, such as what goes wrong in a hazard.
2. Every instruction sentence starts with a verb in the imperative ("Open", "Add", "Run"),
   or with a condition clause ("If ...,") followed by that imperative verb.
3. A condition comes before the instruction it limits ("If X, do Y", never "Do Y if X").
4. Each hazard comes before the step it applies to: it sits in Preconditions & hazards, or
   in the step text ahead of the instruction it warns about, never after it.
5. Acceptance criteria and Contracts state requirements with requirement keywords in
   capitals (MUST, SHOULD, MAY), and at least one such keyword appears.

FAIL if the file is missing or empty, if any check above fails, or if the Steps read as
ordinary prose paragraphs. Name the first sentence that fails a check.
