# 0012: Keep the verdict schema in one module

## Context

The verdict schema was written out by hand in three places. `skills/brigade/SCHEMAS.md` has the
section people read. `workflows/config.js` has a copy of that text in `MD_SCHEMA_BLOCKS.verdict`,
which goes into the inspector's prompt, plus the return shape in `SCHEMA_VERDICT_RETURN`.
`scripts/brigade-validate` has its own severities, verdict values, required keys, budget and body
sections. Nothing tied them together, so a change to one could leave the others behind, and the
inspector could be told one thing while the validator checked another. This change tries one
source on the verdict first, before doing the same for the other artifact types.

## Decision

`scripts/lib/schemas.mjs` holds the verdict schema as plain data: `SEVERITIES`, `VERDICT_VALUES`,
`VERDICT` (its `keys`, `budget`, `sections` and the `doc` text the inspector sees) and
`SCHEMA_VERDICT_RETURN`.

- `brigade-validate` imports those values and keeps no copy of its own.
- `scripts/brigade-bundle` writes the verdict entries in `workflows/config.js` from the module.
  The lines between `// @schemas:begin <name>` and `// @schemas:end <name>` belong to the
  bundler: a plain run rewrites them, and `--check` fails with
  `STALE: workflows/config.js` when they differ from the module. The bundled workflows pick the
  text up from config.js as before.
- `test/scripts/schemas-single-source.test.mjs` checks that SCHEMAS.md's verdict section has the
  same keys, verdict values, severities, budget and sections as the module, and contains its
  `doc` text word for word.

SCHEMAS.md stays written by hand. The test is what keeps it honest.

## Use cases

- Someone adds a severity. They edit the module and run `scripts/brigade-bundle`. The validator
  accepts the new value at once, config.js and the workflows are rewritten, and the test fails
  until SCHEMAS.md says the same.
- Someone edits the verdict text in config.js by hand. `brigade-bundle --check` fails in the gate
  and names config.js.
- Someone edits SCHEMAS.md's verdict example. The test fails and names the part that no longer
  matches.

## Alternatives rejected

- Splicing the module into each workflow ahead of config.js, with config.js referring to
  `VERDICT.doc`. Several regression tests evaluate config.js on its own text, and
  `MD_SCHEMA_BLOCKS` would then point at a name that only exists inside a bundle, so those tests
  would break or need a second copy to fall back on.
- Importing the module from config.js. Workflow scripts cannot import at run time, and config.js
  is pasted into them as text.
- Generating SCHEMAS.md from the module. That section is prose meant for people, and it carries an
  acceptance-pass paragraph the prompt leaves out. A test that compares the two is enough.

## Consequences

- The verdict data has one place to edit, and drift in any copy fails the gate.
- config.js still holds the verdict text, but as generated lines. Editing them by hand no longer
  sticks: the next bundle run puts the module's text back.
- `brigade-validate` now needs `scripts/lib/schemas.mjs` beside it. Anything that copies the
  validator on its own must copy that file too, the way it already copies `lib/plan.mjs`.
- The other artifact types still keep their own copies. Each can move to the module the same way.
