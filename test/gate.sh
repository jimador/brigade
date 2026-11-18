#!/usr/bin/env bash
# Runs the full verification gate from CONTRIBUTING.md, in the same order.
# Stops at the first failing command. Prints GATE OK when every check passes.
set -e
cd "$(dirname "$0")/.."

for f in install.sh scripts/brigade-status hooks/*.sh; do bash -n "$f" || exit 1; done
node --check scripts/brigade-validate
node --check scripts/brigade-config
node --check scripts/brigade-bundle
node --check scripts/brigade-coord
node --check scripts/brigade-subagent-line
node --check scripts/brigade-onboard
node --check scripts/brigade-risk
node --check scripts/brigade-eval
node --check scripts/brigade-evidence
node --check scripts/brigade-pr
node --check scripts/brigade-scope
node --check scripts/brigade-plan-view
node --check scripts/brigade-rehearse
node --check scripts/lib/plan.mjs
node --check scripts/lib/schemas.mjs
node --check hooks/turn-budget.mjs
node --check scripts/board-demo
node --check workflows/config.js
for f in hooks/board/lib/*.mjs; do node --check "$f" || exit 1; done
scripts/brigade-bundle --check
scripts/board-demo --check
python3 -c "import json; [json.load(open(f)) for f in ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json','hooks/hooks.json','settings.json','monitors/monitors.json']]"
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
node --test test/board/*.test.mjs
node --test test/scripts/*.test.mjs
claude plugin test .
./test/regression.sh

echo "GATE OK"
