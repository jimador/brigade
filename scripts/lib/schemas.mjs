// The verdict artifact's schema, kept in one place. brigade-validate imports it, and
// brigade-bundle writes the doc text and the return schema into workflows/config.js so the
// workflows get the same values without importing anything at run time.
//
// Plain data only: no functions, no imports. SCHEMAS.md still carries the human-facing copy of
// the verdict section, and test/scripts/schemas-single-source.test.mjs fails when the two drift.

// Finding severities, most serious first. Verdicts, review reports and red-team records share them.
export const SEVERITIES = ['blocking', 'high', 'medium', 'low']

// The two values an inspector's verdict can take.
export const VERDICT_VALUES = ['PASS', 'FAIL']

// The verdict file's contract: frontmatter keys it must carry beyond the envelope, its body
// line budget, the body sections it must have in order, and the schema text the inspector is
// shown in its prompt (the same text SCHEMAS.md has, minus the acceptance-pass paragraph).
export const VERDICT = {
  keys: ['verdict', 'attempt_reviewed', 'reran_gate', 'findings'],
  budget: 150,
  sections: ['## Verdict', '## Findings', '## Evidence check'],
  doc: `Producer: inspector. Consumers: Planner (merge/rework decision), Analyst.

---
doc: verdict
schema: 1
dish: <dish-slug>
item: <item-slug>
role: inspector
model: <model id that wrote this file>
created: 2026-07-04T03:10:00Z
verdict: PASS                      # PASS|FAIL
attempt_reviewed: 1
reran_gate: true                  # false requires a reason in the body
findings:
  - { id: F1, severity: blocking|high|medium|low, location: "src/foo.ts:42",
      summary: <one line> }
trivial_only: false               # true = all findings annotation-only, no redispatch needed
---

Body sections, in order: \`## Verdict\` (one line), \`## Findings\` (per finding: what's
wrong, why it matters, concrete fix direction — ids matching frontmatter), \`## Evidence
check\` (what was re-run, verbatim result tail). Authority: the actual diff and the
inspector's own command runs; the cook's report is a claim, not a source.
Budget: ≤ 150 lines.`,
}

// What the inspector agent hands back to the execute workflow when it finishes a review.
export const SCHEMA_VERDICT_RETURN = {
  type: 'object',
  required: ['verdict', 'verdictPath', 'trivialOnly', 'findings'],
  properties: {
    verdict: { enum: VERDICT_VALUES },
    verdictPath: { type: 'string' },
    trivialOnly: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'severity', 'location', 'summary'],
        properties: {
          id: { type: 'string' },
          severity: { enum: SEVERITIES },
          location: { type: 'string' },
          summary: { type: 'string' },
        },
      },
    },
    verdictDoc: { type: 'string' },
  },
}
