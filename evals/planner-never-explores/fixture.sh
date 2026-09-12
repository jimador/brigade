#!/usr/bin/env bash
# Fixture: a tiny repo with a brigade board wired to a local markdown source.
set -euo pipefail
git init -q .
mkdir -p .brigade/board src
printf '.brigade/\n' >> .git/info/exclude
cat > package.json <<'JSON'
{ "name": "acme-web", "version": "0.1.0", "scripts": { "test": "node --test src/" } }
JSON
cat > src/login.js <<'JS'
// Login handler for acme-web. Rate limiting is not implemented yet.
module.exports.login = function login(req) {
  return req.password === 'secret' ? { ok: true } : { ok: false }
}
JS
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
cat > .brigade/board/rate-limit-login.md <<'MD'
---
id: rate-limit-login
title: Rate limit the login endpoint
status: todo
assignee: alex
kind: feature
worker: ""
created: 2026-07-01
---

## Goal

Repeated failed logins from one IP are throttled instead of hitting the password check every time.

## Acceptance criteria

- [ ] After 5 failed attempts from an IP within 5 minutes, further attempts return 429.
- [ ] A successful login resets the counter for that IP.
- [ ] The limit is configurable and covered by a test.

## Activity

- 2026-07-01T09:00:00Z [alex] Created.
MD
git add package.json src/login.js
git -c user.name=alex -c user.email=alex@example.com commit -qm "acme-web fixture"
