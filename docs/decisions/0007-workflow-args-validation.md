# 0007: Check every workflow's args at entry and stop loudly on a bad one

## Context

The execute, research and review workflows take their args as one object (or a JSON string of
one) and read keys from it directly. Nothing checked those keys. A missing `items` or `gate`
crashed execute with a TypeError somewhere inside the run, a missing `input` did the same to
review, and a missing path or stamp went into agent prompts as the word "undefined". A key the
script never reads, such as a misspelled one, was dropped without a word. Each of these is a
caller mistake that is cheap to spot at the start and expensive to find after agents have run.

## Decision

`workflows/config.js` gains `validateArgs(spec, A)`. A spec lists required and optional
top-level keys with a type each: `string`, `number`, `boolean`, `array`, `object` (a plain
object, not a list) or `string[]`, plus `any` for a key the script reads in any shape. It returns `{ ok, errors, unknown }` and never throws. A
missing required key gives `missing arg: <key> (<type>)`, a key of the wrong type gives
`arg <key> must be <type>, got <actual>`, and keys the spec does not list come back in
`unknown`. An optional key set to `null` counts as not passed, since the helpers that read
those keys already treat it that way; a required key set to `null` is an error. When `args`
itself is not an object, that is reported too.

`config.js` also holds one spec per workflow, built from what each script reads: execute
requires `dishDir`, `repoRoot`, `now`, `deliveryBranch`, `deliverySlug`, `items` and `gate`;
research requires `dishDir`, `repoRoot`, `now` and `questions`; review requires `repoRoot`,
`now`, `reviewSlug` and `input`. Everything else each script reads is optional with its type.
`writing` is optional with type `any` in all three: `withWritingRules` ignores any shape it
cannot use, and the workflow smoke test pins that a malformed `writing` leaves every prompt as
it was, so it must not stop a run. Review lists it too, though it does not read it, because
the skill tells callers to pass it to every workflow.

Each script calls `validateArgs` right after it parses `args`. Unknown keys get one log line,
`ignoring unknown args: a, b`, and the run goes on. When the check fails, the script logs each
error and returns its usual early-exit shape, with the errors joined by `; ` after
`invalid args: ` as the reason: `reason` for execute (with `stoppedEarly: true`), `error` for
review and research. The stop sits on the first line of each script's runtime body (the start
of `runAll` in execute, the start of the async body in research and review), so no phase starts
and no agent runs. Everything above that line only defines prompts and helpers, and the
regression pins load that part on its own with partial args to test those helpers; stopping
any earlier would break them. Args that are not an object at all stop right after the check,
because the lines below it read keys from them.

`overrides` and `promptOverrides` are only checked to be objects. What sits inside them stays
the job of `resolvePolicy` and `resolvePromptExtras`, which are unchanged, so the `.config` envelope and the bare config, and the `prompts --json` shape and the
plain role map, all pass as before.

## Use cases

- A caller forgets `items` when starting execute: the run stops before any worktree or agent,
  and the result says `invalid args: missing arg: items (array)`.
- A caller passes `gate` as one string instead of a list of commands: the run stops with
  `arg gate must be string[], got string` rather than failing on the first cook prompt.
- A caller passes an extra key the script does not read: the log shows it once and the run
  goes on, so a typo in an optional key is visible instead of silent.
- A caller passes `overrides: null` or leaves `writing` out: nothing changes.

## Alternatives rejected

- Throw on a bad arg. The workflows report fatal problems through their return value, and the
  callers already read `stoppedEarly`, `reason` and `error`; a throw would reach them as a
  harness failure with less to go on.
- Validate inside each script with its own code. Three copies of the same checks drift apart;
  one helper in `config.js` is injected into all three by the bundler anyway.
- Check the insides of `overrides`, `writing` and each item. Those shapes belong to the
  helpers that read them and already tolerate odd values; checking them twice would mean two
  definitions of the same shape.
- Fail on unknown keys. Older or newer callers may pass keys a script does not need, such as
  `writing` to a script that ignores it; stopping a dish for that costs more than a warning.

## Consequences

- A malformed call fails in its first log lines, naming every bad key at once.
- Adding a key a script reads now means adding it to that script's spec in `config.js`,
  or every run that passes it logs it as unknown.
- A `promptOverrides` or `overrides` passed as a string or a list now stops the run with a type
  error. Before, `promptOverrides` of that kind ran on with the warning described in 0006, and
  a non-object `overrides` was quietly ignored.
