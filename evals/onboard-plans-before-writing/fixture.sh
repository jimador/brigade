#!/usr/bin/env bash
# Fixture: a tiny repo with no brigade setup yet; the onboard case is expected to plan it.
set -euo pipefail
git init -q .
mkdir -p src
cat > package.json <<'JSON'
{ "name": "acme-web", "version": "0.1.0", "scripts": { "test": "node --test src/" } }
JSON
cat > src/login.js <<'JS'
// Login handler for acme-web. Rate limiting is not implemented yet.
module.exports.login = function login(req) {
  return req.password === 'secret' ? { ok: true } : { ok: false }
}
JS
git add package.json src/login.js
git -c user.name=alex -c user.email=alex@example.com commit -qm "acme-web fixture"
