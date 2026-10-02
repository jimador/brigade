# Writing preset: ste-80

When you write a work packet, follow these rules.
In these rules, the packet is the work packet that you write.
The reader is the agent that does the work in the packet.
Goal: every language model reads the packet one way, because two readings of one packet give two different builds.
A hazard is a warning that a step can cause damage or a failure.
A description is any other prose in the packet, such as the goal.

## Steps and hazards

Apply the S rules to every step, every hazard and every description in the packet.

- S1. Write one instruction in each sentence.
- S2. Start each instruction with the verb in the imperative, as in "Run the tests".
- S3. Keep each sentence in a step to 20 words or fewer.
- S4. Keep each sentence in a hazard or a description to 25 words or fewer.
- S5. Use the active voice.
- S6. When the actor is not the reader, name the actor, as in "The script writes the log".
- S7. When an instruction has a condition, write the condition first, as in "If the test fails, report the failure".
- S8. Put each hazard before the step that the hazard applies to.
- S9. Use one term for one thing in the whole packet.
- S10. Define each term at the first use of the term.
- S11. If the noun for a pronoun is in an earlier sentence, repeat the noun instead of the pronoun.
- S12. Keep the articles "a", "an" and "the".
- S13. Put at most three nouns in a row. If a noun group is longer, break the group with "of" or "for".
- S14. Give each file path, command and identifier literally, in backticks, as in `src/cache.ts`.
- S15. Copy the exact text of a path, a command or an identifier. The reader cannot find a paraphrase.

## Contracts and acceptance criteria

Apply the C rules to the contracts and to each acceptance criterion in the packet.

- C1. Write the requirement keywords MUST, SHOULD and MAY in capitals.
- C2. Give each keyword the usual meaning. MUST is required, SHOULD applies unless the packet states a reason, and MAY is optional.
- C3. Write each criterion as a fact that a command or a reader can observe, as in "`./test/regression.sh` exits 0".
- C4. State one fact in each criterion. If a criterion holds two facts, split the criterion in two.

## Any language model must be able to read it

Apply the M rules to the whole packet, with or without this preset.

- M1. Use plain Markdown only: headings, lists and fenced code blocks.
- M2. Do not write XML-style tags or chat-template tokens. Use a Markdown heading or a fenced code block instead.
- M3. Do not name a tool as a proper noun. Name the action instead, as in "read the file".
- M4. Do not write slash commands, agent names or model names. Describe the action that the reader must do instead.
- M5. Put in the packet everything that the reader needs. The reader cannot see the planning conversation and cannot ask a question.
- M6. Say what the output is and where the output goes, as in `reports/summary.md`.
- M7. When a format matters, give one example of the format.
- M8. Say what the reader must do. When you forbid an action, name the action to do instead.
- M9. Give the goal and the reason once, at the top. Then give the steps.
- M10. Keep both the goal and the steps. Some models work from the goal, and other models work from the steps.

## What this preset leaves out

- This preset is based on the sentence rules of ASD-STE100 (Simplified Technical English) and does not claim conformance.
- The name `ste-80` means about 80% of the strictness of the full specification.
- The preset leaves out the approved-word dictionary of the full specification. Use common words that the reader knows.
- The Goal section of the packet and the reason for a hazard MAY use a plain "because".
