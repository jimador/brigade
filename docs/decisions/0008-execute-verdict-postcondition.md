# 0008: Check that a PASS verdict is on disk before the execute workflow lands it

## Context

An inspector in the execute workflow returns its verdict twice: as a structured return the
workflow reads, and as a verdict file the steward reads before it lands. Sometimes the return
says PASS but the file never reaches disk. The usual cause is the harness turning down the
inspector's Write call, telling it to return findings as text instead. The steward then
correctly refuses to land, since a verdict nobody wrote is not permission to merge, and the
item ends `rework-needed`. Each time, the planner had to run another inspector by hand. One
dish needed that twice.

## Decision

After a PASS, and before landing, the workflow asks a steward to look for the verdict file.
The workflow cannot read files itself, so this check is an agent call: the probe runs
`head -12` and `brigade-validate` on the verdict path and returns `exists`, `valid` and
`detail` (`SCHEMA_VERDICT_PROBE` in `workflows/config.js`). It writes nothing. `valid` means
validate printed `ok` and the frontmatter says `doc: verdict` and `verdict: PASS`. When the
workflow is landing a FAIL whose findings are all trivial, which it already does today,
`verdict: FAIL` with `trivial_only: true` is accepted as well.

The inspector is now asked to return the full text of its verdict file in an optional
`verdictDoc` field. When the probe misses and that text is a well-formed verdict that allows
landing, a steward writes it to the verdict path with one quoted heredoc that the workflow
builds. The text goes in unchanged, followed by one last line saying the workflow transcribed
it because the inspector's own write was refused. Then the probe looks again. The inspector
still wrote every word, and the workflow writes nothing of its own beyond that one line.

When there is no usable text, or the probe still misses, one fresh inspector runs. It gets the
same prompt plus one sentence saying the previous inspector's verdict file never reached disk
and that nothing lands until it writes the file. A FAIL from it is handled like any other
FAIL. A PASS from it goes through the same probe, with its own `verdictDoc` written out first
when the file is missing. If the file is still missing after that, the item is blocked with
`verdict file missing after a fresh inspector: <path>`. That attempt is recorded with cause
`no-result` and does not count toward the circuit breaker's limit on inspector FAILs.

The steward's own check of the verdict file before landing stays as it is. The steward calls
for landing, the probe and the transcription now share one helper.

## Use cases

- The inspector's Write call is refused, but it returned the verdict text: the text is written
  out with the transcription line, the probe finds it, and the item lands. No second inspector
  runs.
- The inspector returned PASS and wrote nothing usable: a fresh inspector reviews the diff and
  writes the file, and the item lands.
- The fresh inspector finds a real problem: its FAIL sends the item to the next rung with its
  findings, as any FAIL would.
- Neither inspector gets a file onto disk: the item is blocked with the path named, so the
  planner knows exactly what is missing.

## Alternatives rejected

- Let the steward write the verdict from the structured return. A verdict the landing step
  writes for itself would authorize its own merge. The transcription writes only text the
  inspector produced, and it is checked by the same validator.
- Retry the fresh inspector until a file appears. Without a cap, a harness that keeps refusing
  writes would use up the run. One retry covers the common case, and a block names the path.
- Count the missing file as an inspector FAIL. The work was never judged bad, and counting it
  would trip the breaker for a harness problem.
- Require `verdict: PASS` even for a trivial-only FAIL. Those land today, so the check would
  have sent every one of them to a second inspector and then blocked them.

## Consequences

- A PASS now costs one more cheap steward call before landing, and up to four more when the
  file is missing.
- Verdict files written by the workflow end with the transcription line, so a later reader can
  tell them apart.
- `SCHEMA_VERDICT_RETURN` gains the optional `verdictDoc`. Older inspector returns without it
  still work, and simply skip the transcription step.
