# 0006: Let the workflows read prompt overrides in either shape, and warn when none applied

## Context

The execute, review and research workflows take an operator's prompt overrides as
`args.promptOverrides` and read `promptOverrides.<role>` as a list of text to append to that
role's prompt. The skill docs tell the caller to pass the whole output of
`brigade-config prompts --json`, and that output keeps the text under `.text`, next to an
`overrides` listing of where each fragment came from. So a caller who followed the docs passed
an object with no `cook` or `inspector` key at the top, every override was dropped, and nothing
said so. The run looked normal while ignoring the operator's instructions.

## Decision

`workflows/config.js` gains `resolvePromptExtras(raw)`, which returns
`{ extras, dropped }`. It accepts the `prompts --json` shape and uses its `text` map, and it
accepts a plain `{ <role>: [text…] }` map and uses it as is. An `overrides` listing with no
`text` (output from an older `brigade-config`) and any other value that gives no role any text
come back with empty extras and `dropped: true`. Nothing passed, `null` and `{}` are not a
problem and are not flagged, and neither is a `prompts --json` output from a repo with no
overrides at all. Each workflow calls it once at the top and, when `dropped` is set, logs one
line telling the operator to pass the whole output of `brigade-config prompts --json`.
`withPromptOverrides` is unchanged.

## Use cases

- A caller passes the whole `prompts --json` output, as the docs say: each role's text is
  appended to that role's prompts.
- A caller or an older skill passes `{ cook: ['…'] }` directly: it works as it did before.
- A caller passes `prompts --json` output from an older `brigade-config`, which lists the
  override files but not their text: the run goes on with the shipped prompts and the log says
  the overrides carried no text.
- A repo has no prompt overrides: no extras, no warning.

## Alternatives rejected

- Change the skill docs to pass only `.text`. That fixes one caller and leaves the next one to
  make the same mistake with nothing in the log to catch it.
- Make `withPromptOverrides` dig into the `prompts --json` shape itself. It is called per role
  with a list of fragments; teaching it about the whole document would mix two jobs and change a
  function every prompt already goes through.
- Fail the run when overrides carry no text. Overrides add to the shipped prompts and never
  replace them, so running without them is safe; stopping a dish for it costs more than a
  warning does.

## Consequences

- Both shapes keep working, so callers do not have to change in step with this release.
- A value that applies nothing now shows up as one log line at the start of the run instead of
  passing silently.
- A JSON string passed as `promptOverrides` is not parsed; it counts as a value with no text
  and gets the warning.
