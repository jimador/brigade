#!/usr/bin/env bash
# Fixture: a tiny repo with a brigade board, one small ticket, and a repo config that turns
# on the ste-80 writing preset for the packets the planner writes.
set -euo pipefail
git init -q .
mkdir -p .brigade/board src
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
{ "writing": { "preset": "ste-80" } }
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
cat > .brigade/board/trim-display-name.md <<'MD'
---
id: trim-display-name
title: Cut long display names to 40 characters
status: todo
assignee: alex
kind: feature
worker: ""
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
MD
git add package.json src/profile.js brigade.config.json
git -c user.name=alex -c user.email=alex@example.com commit -qm "acme-web fixture"
