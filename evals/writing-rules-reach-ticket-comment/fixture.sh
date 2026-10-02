#!/usr/bin/env bash
# Fixture: a tiny repo whose one ticket has just been cooked. The change is committed, the
# dish's acceptance pass is green, and the repo config sets two writing rules for the ticket
# comment, so the handoff comment is the only thing left to write.
set -euo pipefail
git init -q .
mkdir -p .brigade/board .brigade/dishes/trim-display-name/reports src
printf '.brigade/\n' >> .git/info/exclude
cat > package.json <<'JSON'
{ "name": "acme-web", "version": "0.1.0", "scripts": { "test": "node --test src/*.test.js" } }
JSON
cat > src/profile.js <<'JS'
// Profile helpers for acme-web. displayName is the text the profile header shows.
module.exports.displayName = function displayName(user) {
  return user.name.trim()
}
JS
cat > brigade.config.json <<'JSON'
{ "writing": { "rules": { "ticket_comment": ["Start the comment with the word Outcome:", "Write at most five sentences."] } } }
JSON
cat > .brigade/config.md <<'MD'
# Brigade config — acme-web

## Source

- source: local
- transport: fs
- database_id: .brigade/board
- user: alex

### Status mapping (abstract → native)

- backlog: backlog
- scoping: scoping
- design: design
- todo: todo
- in_progress: in_progress
- in_review: in_review
- done: done
- blocked: blocked

## Repo

- main_branch: main
- tier: two-star
- verification_gate:
  - npm test
- test_convention: node --test files beside the code under src/
- remote_pr: false
MD
git add package.json src/profile.js brigade.config.json
git -c user.name=alex -c user.email=alex@example.com commit -qm "acme-web fixture"

# The cooked change: cut long names at 40 characters, counting characters rather than
# UTF-16 units so an emoji is never split.
cat > src/profile.js <<'JS'
// Profile helpers for acme-web. displayName is the text the profile header shows; names
// longer than 40 characters are cut to 39 plus an ellipsis so they never wrap the header.
const MAX = 40
module.exports.displayName = function displayName(user) {
  const chars = Array.from(user.name.trim())
  return chars.length <= MAX ? chars.join('') : chars.slice(0, MAX - 1).join('') + '…'
}
JS
cat > src/profile.test.js <<'JS'
const test = require('node:test')
const assert = require('node:assert')
const { displayName } = require('./profile')

test('a 40-character name comes back unchanged', () => {
  assert.strictEqual(displayName({ name: 'a'.repeat(40) }), 'a'.repeat(40))
})
test('a 41-character name is cut to 39 characters and an ellipsis', () => {
  assert.strictEqual(displayName({ name: 'a'.repeat(41) }), 'a'.repeat(39) + '…')
})
test('an emoji at the cut is kept whole', () => {
  assert.strictEqual(displayName({ name: 'a'.repeat(38) + '🙂🙂🙂' }), 'a'.repeat(38) + '🙂…')
})
JS
git add src/profile.js src/profile.test.js
git -c user.name=alex -c user.email=alex@example.com commit -qm "profile: cut display names longer than 40 characters"

cat > .brigade/board/trim-display-name.md <<'MD'
---
id: trim-display-name
title: Cut long display names to 40 characters
status: in_progress
assignee: alex
kind: feature
worker: brigade-cook
created: 2026-07-01
---

## Goal

A display name longer than 40 characters shows as its first 39 characters plus an ellipsis,
so long names stop wrapping the profile header.

## Acceptance criteria

- [ ] A trimmed name of 40 characters or fewer comes back unchanged.
- [ ] A trimmed name longer than 40 characters comes back as its first 39 characters followed by "…".
- [ ] A name with an emoji near the cut is never split in the middle of the emoji.
- [ ] Each case is covered by a test in src/profile.test.js.

## Activity

- 2026-07-01T09:00:00Z [alex] Created.
- 2026-07-02T10:00:00Z [alex] Claimed by brigade; dish trim-display-name started.
MD
cat > .brigade/dishes/trim-display-name/PLAN.md <<'MD'
# Plan — trim-display-name

One item, `cut-long-names`: change `displayName` in src/profile.js to cut names longer than
40 characters, counting characters with Array.from, and add src/profile.test.js.

Landed on main as "profile: cut display names longer than 40 characters". Gate: npm test.
MD
cat > .brigade/dishes/trim-display-name/reports/acceptance-verdict.md <<'MD'
# Acceptance pass — trim-display-name

| Criterion | Verdict | Evidence |
|---|---|---|
| 40 characters or fewer unchanged | COVERED-BY-GATE | test "a 40-character name comes back unchanged" |
| Longer than 40 cut to 39 plus "…" | COVERED-BY-GATE | test "a 41-character name is cut to 39 characters and an ellipsis" |
| Emoji never split | COVERED-BY-GATE | test "an emoji at the cut is kept whole" |
| Tests in src/profile.test.js | VERIFIED | `npm test`: 3 tests, 3 pass, 0 fail |
MD
