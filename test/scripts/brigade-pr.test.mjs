// Tests for the red-team and PR template settings in brigade-config, and for brigade-pr.
// Every test drives the real scripts against a throwaway git repo and a fake home, so they
// prove what a session sees. Run with `node --test test/scripts/*.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = path.join(ROOT, 'scripts', 'brigade-config')
const PR = path.join(ROOT, 'scripts', 'brigade-pr')

// A repo with one commit on main and a feature branch one commit ahead. `files` lands on the
// feature branch; `team` and `local` are the config layers.
function fixture({ team = null, local = null, files = { 'src/widget.js': 'export const widget = 1\n' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-pr-'))
  const g = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=alex', '-c', 'user.email=alex@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { stdio: 'pipe' })
  g('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(dir, 'README.md'), 'acme\n')
  g('add', 'README.md')
  g('commit', '-q', '-m', 'base')
  g('switch', '-q', '-c', 'feat/widgets')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
    g('add', file)
  }
  g('commit', '-q', '-m', 'widgets')
  fs.mkdirSync(path.join(dir, 'home'))
  fs.mkdirSync(path.join(dir, '.brigade'))
  if (team) fs.writeFileSync(path.join(dir, 'brigade.config.json'), JSON.stringify(team))
  if (local) fs.writeFileSync(path.join(dir, '.brigade', 'config.local.json'), JSON.stringify(local))
  const head = g('rev-parse', 'HEAD').toString().trim()
  return { dir, head }
}

// A PATH holding only node and git, both symlinked from wherever they live now, so no review
// tool beside node (for example `claude` in node's own bin directory) can be found.
function bareToolPath() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'brigade-pr-nobin-'))
  fs.symlinkSync(fs.realpathSync(process.execPath), path.join(bin, 'node'))
  const gitBin = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .map((dir) => path.join(dir, 'git'))
    .find((candidate) => { try { fs.accessSync(candidate, fs.constants.X_OK); return true } catch { return false } })
  assert.ok(gitBin, 'git must be on PATH to run this test')
  fs.symlinkSync(fs.realpathSync(gitBin), path.join(bin, 'git'))
  return bin
}

// A PATH holding only stub programs named `bins`, plus what git and node need.
function stubPath(dir, bins, scripts = {}) {
  const bin = path.join(dir, 'stub-bin')
  fs.mkdirSync(bin, { recursive: true })
  for (const name of bins) {
    fs.writeFileSync(path.join(bin, name), scripts[name] ?? '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  }
  return [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter)
}

function run(script, dir, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, BRIGADE_HOME: path.join(dir, 'home'), ...env },
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

const config = (dir, ...args) => run(CONFIG, dir, args)
const pr = (dir, args, env) => run(PR, dir, args, env)

function body(head, { validation, screenshots, review, layer = '1 of 1' } = {}) {
  const short = head.slice(0, 12)
  return [
    '## What changes', 'Callers can now list widgets by owner.',
    '## Stack', `- Layer: ${layer}`, '- Parent: main',
    '## Surfaces', '`GET /widgets?owner=<id>`',
    '## On failure', 'An unknown owner returns 404 with the owner id.',
    '## How it was validated', validation ?? 'Ran the unit suite on the head.\n\nScope: full\n\n```text\n$ npm test\n12 passing\n```',
    '## Screenshots', screenshots ?? 'n/a, nothing on screen changes here',
    '## Red-team review', review ?? [
      `- Head: ${short}`, `- Range: main...${short}`, '- Find pass: Codex, codex review --base main',
      '- Verify pass: Claude Code, claude -p', '- Findings: 1 confirmed and fixed, 2 refuted', '- Verdict: clean',
    ].join('\n'),
    '## Risk and rollback', 'Revert the commit; no stored data changes.',
  ].join('\n\n')
}

function check(dir, text, args = [], env) {
  const file = path.join(dir, '.brigade', 'pr-body.md')
  fs.writeFileSync(file, text)
  return pr(dir, ['check', file, ...args], env)
}

// ---------------------------------------------------------------- config

test('the defaults carry the red team and PR template, and doctor accepts them', () => {
  const { dir } = fixture()
  const doc = JSON.parse(config(dir, 'resolve', '--json').out)
  const rt = doc.config.review.redTeam
  assert.equal(rt.required, true)
  assert.deepEqual(rt.lenses.map((l) => l.id), ['correctness', 'failure', 'security', 'concurrency', 'compatibility', 'tests', 'scope'])
  assert.deepEqual(rt.reviewerOrder, ['codex', 'claude', 'cursor'])
  assert.equal(rt.reviewers.codex.find, 'codex review --base {base} < /dev/null')
  assert.deepEqual(doc.config.prTemplate.sections.map((s) => s.title), [
    'What changes', 'Stack', 'Surfaces', 'On failure', 'How it was validated', 'Screenshots', 'Red-team review', 'Risk and rollback',
  ])
  assert.equal(doc.config.prTemplate.size.maxChangedLines, 400)
  assert.equal(config(dir, 'doctor').code, 0)
})

test('lenses and sections merge by id across layers, and get names the layer that set one', () => {
  const { dir } = fixture({
    team: {
      review: { redTeam: {
        lenses: [{ id: 'concurrency', enabled: false }, { id: 'containment', title: 'Containment', lens: 'A guest reaching the host.' }],
        reviewers: { codex: { find: 'codex exec "Find pass. Read {brief}." < /dev/null' } },
      } },
      prTemplate: { sections: [{ id: 'screenshots', enabled: false }], size: { maxChangedLines: 800 } },
    },
    local: { prTemplate: { sections: [{ id: 'risk', title: 'Risk' }] } },
  })
  const doc = JSON.parse(config(dir, 'resolve', '--json').out)
  const rt = doc.config.review.redTeam
  assert.equal(rt.lenses.find((l) => l.id === 'concurrency').enabled, false)
  assert.equal(rt.lenses.find((l) => l.id === 'concurrency').title, 'Concurrency')
  assert.equal(rt.lenses.at(-1).id, 'containment')
  assert.equal(rt.reviewers.codex.find, 'codex exec "Find pass. Read {brief}." < /dev/null')
  assert.equal(rt.reviewers.codex.verify.includes('{findings}'), true, 'a patched tool keeps its other commands')
  assert.equal(doc.config.prTemplate.sections.find((s) => s.id === 'risk').title, 'Risk')
  assert.equal(doc.config.prTemplate.sections.find((s) => s.id === 'risk').kind, 'text')
  assert.equal(doc.config.prTemplate.size.maxStackDepth, 5)
  assert.equal(doc.provenance['review.redTeam.lenses.containment'], 'team')
  assert.equal(doc.provenance['prTemplate.sections.risk'], 'local')
  assert.equal(doc.provenance['prTemplate.size.maxChangedLines'], 'team')
  const got = JSON.parse(config(dir, 'get', 'review.redTeam.lenses.containment', '--json').out)
  assert.equal(got.value.title, 'Containment')
  assert.equal(got.from, 'team')
  assert.equal(config(dir, 'doctor').code, 0)
})

test('doctor names each bad red-team or template setting', () => {
  const { dir } = fixture({
    team: {
      review: { redTeam: {
        findingFormat: 'yaml',
        lenses: [{ id: 'x', title: 'X', lens: 'one' }, { id: 'x', title: 'X', lens: 'two' }],
        reviewerOrder: ['codex', 'gemini'],
        reviewers: { codex: { verify: 'codex exec "verify" < /dev/null' } },
      } },
      prTemplate: {
        sections: [{ id: 'review', enabled: false }, { id: 'odd', title: 'Odd', kind: 'poem', required: true }],
        size: { enforce: 'loud' },
        uiPaths: ['web/**'],
      },
    },
    local: { prTemplate: { sections: [{ id: 'screenshots', required: false, requiredWhen: null }] } },
  })
  const r = config(dir, 'doctor', '--json')
  assert.equal(r.code, 1)
  const problems = JSON.parse(r.out).problems.map((p) => p.problem).join('\n')
  for (const want of [
    'review.redTeam.findingFormat must be one of compiler, plain',
    'duplicate review.redTeam.lenses id "x"',
    'review.redTeam.reviewerOrder names "gemini"',
    "review.redTeam.reviewers.codex.verify must take the find pass's output as {findings}",
    'prTemplate.sections "odd": kind must be one of',
    'prTemplate.sections needs an enabled section of kind "review"',
    'prTemplate.size.enforce must be one of error, warning',
    'prTemplate.sections "screenshots": requiredWhen may only be "ui"',
  ]) assert.ok(problems.includes(want), `doctor missed: ${want}\n${problems}`)
})

test('an advisory red team may drop the review section', () => {
  const { dir } = fixture({ team: { review: { redTeam: { required: false } }, prTemplate: { sections: [{ id: 'review', enabled: false }] } } })
  assert.equal(config(dir, 'doctor').code, 0)
})

// ---------------------------------------------------------------- template

test('the template follows the configured sections', () => {
  const { dir } = fixture({ team: { prTemplate: { sections: [
    { id: 'screenshots', enabled: false },
    { id: 'migration', title: 'Migration', kind: 'text', required: true, hint: 'How stored data moves.' },
  ] } } })
  const r = pr(dir, ['template'])
  assert.equal(r.code, 0, r.err)
  const titles = r.out.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3))
  assert.deepEqual(titles, ['What changes', 'Stack', 'Surfaces', 'On failure', 'How it was validated', 'Red-team review', 'Risk and rollback', 'Migration'])
  assert.match(r.out, /Scope: <full, or targeted and what it leaves out>/)
  assert.match(r.out, /- Verdict: <clean, or the findings still open>/)
})

test('a template refuses to render from invalid red-team settings', () => {
  const { dir } = fixture({ team: { prTemplate: { size: { enforce: 'loud' } } } })
  const r = pr(dir, ['template'])
  assert.equal(r.code, 2)
  assert.match(r.err, /prTemplate\.size\.enforce/)
})

// ---------------------------------------------------------------- check

test('a fully filled body passes, and the unfilled template fails on every placeholder', () => {
  const { dir, head } = fixture()
  const ok = check(dir, body(head))
  assert.equal(ok.code, 0, ok.out + ok.err)
  assert.match(ok.out, /check: ok/)
  const skeleton = pr(dir, ['template']).out
  const bad = check(dir, skeleton)
  assert.equal(bad.code, 1)
  for (const want of ['What changes: the section is empty', 'Stack: a placeholder is left', 'How it was validated: a placeholder is left',
    'Red-team review: a placeholder is left', 'Risk and rollback: the section is empty']) {
    assert.ok(bad.out.includes(want), `missing: ${want}\n${bad.out}`)
  }
})

test('a review of an older head is stale, and a range must end at the reviewed head', () => {
  const { dir } = fixture()
  const old = 'abcdef0123456789abcdef0123456789abcdef01'
  const stale = check(dir, body(old))
  assert.equal(stale.code, 1)
  assert.match(stale.out, /the review covers abcdef012345, but the head is/)
})

test('validation needs prose, a scope, and output for every gate command', () => {
  const { dir, head } = fixture({ team: { gate: ['npm test', 'npm run lint'] } })
  const missing = check(dir, body(head))
  assert.equal(missing.code, 1)
  assert.match(missing.out, /the required command npm run lint is missing/)
  const noScope = check(dir, body(head, { validation: 'Ran both.\n\n```text\n$ npm test\nok\n$ npm run lint\nclean\n```' }))
  assert.match(noScope.out, /"Scope:" is missing/)
  const onlyScope = check(dir, body(head, { validation: 'Scope: full\n\n```text\n$ npm test\nok\n$ npm run lint\nclean\n```' }))
  assert.match(onlyScope.out, /say how you validated the change/)
  const good = check(dir, body(head, { validation: 'Ran both on the head.\n\nScope: full\n\n```text\n$ npm test\nok\n$ npm run lint\nclean\n```' }))
  assert.equal(good.code, 0, good.out)
})

test('brigade-evidence holds the scope line: a targeted run never backs a full scope', () => {
  const { dir, head } = fixture()
  const targeted = '```text\n$ npm test src/widget.test.js\n3 passing\n```'
  const claimsFull = check(dir, body(head, { validation: `Ran the widget tests.\n\nScope: full\n\n${targeted}` }))
  assert.equal(claimsFull.code, 1)
  assert.match(claimsFull.out, /npm test src\/widget\.test\.js is a targeted run \(targets src\/widget\.test\.js\)/)
  const bare = check(dir, body(head, { validation: `Ran the widget tests.\n\nScope: targeted\n\n${targeted}` }))
  assert.match(bare.out, /a targeted scope says what it leaves out/)
  const honest = check(dir, body(head, { validation: `Ran the widget tests.\n\nScope: targeted, the rest of the suite did not run\n\n${targeted}` }))
  assert.equal(honest.code, 0, honest.out)
})

test('--ready needs a clean verdict or a human override', () => {
  const { dir, head } = fixture()
  const short = head.slice(0, 12)
  const open = body(head, { review: [`- Head: ${short}`, `- Range: main...${short}`, '- Find pass: Codex', '- Verify pass: Claude Code',
    '- Findings: 1 confirmed, open', '- Verdict: open, error[review:lost-update] in src/widget.js'].join('\n') })
  assert.equal(check(dir, open).code, 0, 'a draft may carry open findings')
  const ready = check(dir, open, ['--ready'])
  assert.equal(ready.code, 1)
  assert.match(ready.out, /a PR is ready only with a clean verdict/)
  assert.equal(check(dir, body(head), ['--ready']).code, 0)
  const waived = check(dir, body(head, { review: 'Override: alex, the release window closes tonight' }), ['--ready'])
  assert.equal(waived.code, 0, waived.out)
  assert.match(waived.out, /waived by a human override: alex/)
  const noReason = check(dir, body(head, { review: 'Override: alex' }))
  assert.match(noReason.out, /an override names the human and a reason/)
})

test('a UI change needs a screenshot; n/a needs a reason', () => {
  const { dir, head } = fixture({ team: { prTemplate: { uiPaths: ['src/**'] } } })
  const r = check(dir, body(head))
  assert.equal(r.code, 1)
  assert.match(r.out, /this is a UI change, so it needs real screenshots/)
  assert.equal(check(dir, body(head, { screenshots: '![widget list](https://example.com/w.png)' })).code, 0)
  const plain = fixture()
  assert.match(check(plain.dir, body(plain.head, { screenshots: 'n/a' })).out, /n\/a needs a reason of at least three words/)
})

test('size over the limit fails at error and only warns at warning', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const hard = fixture({ team: { prTemplate: { size: { maxChangedLines: 10 } } }, files: { 'src/big.js': lines } })
  assert.match(check(hard.dir, body(hard.head)).out, /size: 30 changed lines, over the limit of 10/)
  assert.equal(pr(hard.dir, ['size']).code, 1)
  const soft = fixture({ team: { prTemplate: { size: { maxChangedLines: 10, enforce: 'warning' } } }, files: { 'src/big.js': lines } })
  const r = check(soft.dir, body(soft.head))
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /warning: size: 30 changed lines/)
  const excluded = fixture({ team: { prTemplate: { size: { maxChangedLines: 10, exclude: ['src/**'] } } }, files: { 'src/big.js': lines } })
  assert.equal(pr(excluded.dir, ['size']).code, 0)
})

test('check --pr reads the published body and its head through gh', () => {
  const { dir, head } = fixture()
  const published = JSON.stringify({ body: body(head), baseRefName: 'main', headRefOid: head })
  fs.writeFileSync(path.join(dir, 'pr.json'), published)
  // The stub answers `gh pr view` from a file; origin/main is the local main under another name.
  execFileSync('git', ['-C', dir, 'update-ref', 'refs/remotes/origin/main', 'main'])
  const gh = `#!/bin/sh\ncat "${path.join(dir, 'pr.json')}"\n`
  const env = { PATH: stubPath(dir, ['gh'], { gh }) }
  const r = pr(dir, ['check', '--pr', '7', '--ready'], env)
  assert.equal(r.code, 0, r.out + r.err)
  fs.writeFileSync(path.join(dir, 'pr.json'), JSON.stringify({ body: body(head), baseRefName: 'main', headRefOid: 'f'.repeat(40) }))
  const pushed = pr(dir, ['check', '--pr', '7'], env)
  assert.equal(pushed.code, 1)
  assert.match(pushed.out, /review the changed range again/)
})

// ---------------------------------------------------------------- commits

// Adds an empty commit with this exact subject; verbatim cleanup keeps leading spaces.
function commit(dir, subject) {
  execFileSync('git', ['-C', dir, '-c', 'user.name=alex', '-c', 'user.email=alex@example.com', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '--cleanup=verbatim', '-m', subject], { stdio: 'pipe' })
  return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']).toString().trim()
}

test('commits passes a clean range and counts what it checked', () => {
  const { dir } = fixture()
  commit(dir, 'Wipe stale widget caches on owner change')
  const r = pr(dir, ['commits'])
  assert.equal(r.code, 0, r.out + r.err)
  assert.equal(r.out.trim(), 'commits OK: 2 checked')
})

test('commits names each WIP, fixup! and squash! subject, in any case and after leading spaces', () => {
  for (const subject of ['WIP: widgets by owner', 'wip', '  Wip widgets', 'fixup! widgets', 'FIXUP! widgets', 'squash! widgets', ' Squash! widgets']) {
    const { dir } = fixture()
    const sha = commit(dir, subject)
    commit(dir, 'List widgets by owner')
    const r = pr(dir, ['commits'])
    assert.equal(r.code, 1, `${subject}: ${r.out}`)
    assert.equal(r.out.trim(), `bad commit subject: ${sha} ${subject}`, subject)
  }
})

test('commits honors --base and --head, and refuses a range it cannot resolve', () => {
  const { dir } = fixture()
  const wip = commit(dir, 'WIP: owner filter')
  const layer = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim()
  commit(dir, 'Filter widgets by owner')
  assert.equal(pr(dir, ['commits']).code, 1, 'the WIP commit is in main..HEAD')
  const above = pr(dir, ['commits', '--base', layer])
  assert.equal(above.code, 0, above.out)
  assert.equal(above.out.trim(), 'commits OK: 1 checked')
  const upTo = pr(dir, ['commits', '--head', layer])
  assert.equal(upTo.code, 1)
  assert.match(upTo.out, new RegExp(`bad commit subject: ${wip} WIP: owner filter`))
  const missing = pr(dir, ['commits', '--base', 'no-such-branch'])
  assert.equal(missing.code, 2)
  assert.match(missing.err, /could not list no-such-branch\.\.HEAD/)
})

// ---------------------------------------------------------------- red team

test('the find pass skips the author tool and the verify pass skips the find tool', () => {
  const { dir, head } = fixture()
  const env = { PATH: stubPath(dir, ['codex', 'claude', 'agent']) }
  const plan = (author) => JSON.parse(pr(dir, ['redteam', '--author', author, '--json'], env).out)
  assert.deepEqual([plan('claude').find.tool, plan('claude').verify.tool], ['codex', 'claude'])
  assert.deepEqual([plan('codex').find.tool, plan('codex').verify.tool], ['claude', 'codex'])
  assert.deepEqual([plan('cursor').find.tool, plan('cursor').verify.tool], ['codex', 'claude'])
  const p = plan('claude')
  assert.equal(p.head, head)
  assert.equal(p.range, `main...${head}`)
  assert.equal(p.find.command, 'codex review --base main < /dev/null')
  assert.equal(p.sameTool, false)
})

test('a missing tool is skipped, the next one takes its place, and none at all stops the review', () => {
  const { dir } = fixture()
  const onlyClaude = JSON.parse(pr(dir, ['redteam', '--json'], { PATH: stubPath(dir, ['claude']) }).out)
  assert.equal(onlyClaude.find.tool, 'claude')
  assert.equal(onlyClaude.verify.tool, 'claude')
  assert.equal(onlyClaude.sameTool, true)
  assert.deepEqual(onlyClaude.skipped.map((s) => s.tool), ['codex', 'cursor'])
  const none = pr(dir, ['redteam'], { PATH: bareToolPath() })
  assert.equal(none.code, 1)
  assert.match(none.out, /no review tool is installed; stop, leave the PR in draft/)
})

test('a red team with no Claude session is refused; Claude alone, or Claude with Codex, is accepted', () => {
  const { dir } = fixture()
  // bareToolPath holds only node and git, so the stubs added here are the only review tools.
  const only = (...bins) => {
    const bin = bareToolPath()
    for (const name of bins) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    return bin
  }
  const codexOnly = pr(dir, ['redteam'], { PATH: only('codex') })
  assert.equal(codexOnly.code, 1)
  assert.match(codexOnly.out, /neither pass runs in a Claude session/)
  const noClaude = pr(dir, ['redteam'], { PATH: only('codex', 'agent') })
  assert.equal(noClaude.code, 1)
  assert.match(noClaude.out, /neither pass runs in a Claude session/)
  const claudeOnly = pr(dir, ['redteam'], { PATH: only('claude') })
  assert.equal(claudeOnly.code, 0)
  assert.match(claudeOnly.out, /warning: only one review tool is installed/)
  assert.equal(pr(dir, ['redteam'], { PATH: only('codex', 'claude') }).code, 0)
})

test('a Claude session is decided by the command that runs, never by the reviewer id', () => {
  const stubs = (dir, ...bins) => ({ PATH: stubPath(dir, bins) })
  const verifyCmd = '{findings} {base} {head} {brief}'
  // id `opus` with bin claude and claude commands counts, even with the `claude` entry switched off.
  const alias = fixture({ team: { review: { redTeam: { reviewers: {
    claude: { enabled: false },
    opus: { name: 'Opus', bin: 'claude', find: 'claude -p --model opus "find {base}...{head}"', verify: `claude -p --model opus "verify ${verifyCmd}"` },
  } } } } })
  const ok = pr(alias.dir, ['redteam'], stubs(alias.dir, 'codex', 'claude'))
  assert.equal(ok.code, 0, ok.out)
  // an env assignment before the executable does not hide it
  const env = fixture({ team: { review: { redTeam: { reviewers: {
    claude: { find: 'CLAUDE_X=1 claude -p "find {base}...{head}"', verify: 'CLAUDE_X=1 claude -p "verify {findings}"' },
  } } } } })
  assert.equal(pr(env.dir, ['redteam'], stubs(env.dir, 'claude')).code, 0)
  // id `claude` with bin codex and codex commands is Codex alone: refused
  const fooled = fixture({ team: { review: { redTeam: { reviewers: {
    claude: { name: 'Fake', bin: 'codex', find: 'codex review --base {base}', verify: 'codex exec "verify {findings}"' },
  } } } } })
  const refused = pr(fooled.dir, ['redteam'], stubs(fooled.dir, 'codex'))
  assert.equal(refused.code, 1)
  assert.match(refused.out, /neither pass runs in a Claude session/)
  // the default claude entry with its commands overridden to codex is refused the same way
  const swapped = fixture({ team: { review: { redTeam: { reviewers: {
    claude: { find: 'codex review --base {base}', verify: 'codex exec "verify {findings}"' },
  } } } } })
  const swappedOut = pr(swapped.dir, ['redteam'], stubs(swapped.dir, 'codex', 'claude'))
  assert.equal(swappedOut.code, 1)
  assert.match(swappedOut.out, /neither pass runs in a Claude session/)
})

test('runsClaude accepts real Claude invocations behind wrappers and refuses look-alikes', () => {
  const accepted = [
    'claude -p x', 'timeout 600 claude -p x', 'timeout -k 5 -s KILL 600 claude -p x', 'env FOO=1 claude -p x',
    'env -u HOME FOO=1 claude -p x', 'FOO=1 BAR=2 claude -p x', 'nice -n 5 claude -p x', 'command claude -p x',
    'exec claude -p x', 'npx -y @anthropic-ai/claude-code -p x', 'npx claude -p x', 'bunx @anthropic-ai/claude-code -p x',
    '"claude" -p x', "'/opt/x/claude' -p x", 'timeout 60 env A=1 nice -n 2 claude -p x',
  ]
  const refused = [
    'claudex review', 'claude-codex review', '/usr/local/bin/claude-codex review', 'codex exec x',
    'sh -c "codex exec x"', 'env FOO=1 codex exec x', 'timeout 600 codex exec x', 'npx codex exec x',
  ]
  for (const [cmds, want] of [[accepted, 0], [refused, 1]]) {
    for (const cmd of cmds) {
      const f = fixture({ team: { review: { redTeam: { reviewers: {
        claude: { bin: 'claude', find: `${cmd} "find {base}...{head}"`, verify: `${cmd} "verify {findings}"` },
      } } } } })
      const res = pr(f.dir, ['redteam'], { PATH: stubPath(f.dir, ['claude']) })
      assert.equal(res.code, want, `${cmd}: ${res.out}`)
      if (want) assert.match(res.out, /neither pass runs in a Claude session/, cmd)
    }
  }
})

test('a switched-off tool is skipped, and the brief carries the configured lenses', () => {
  const { dir, head } = fixture({ team: { review: { redTeam: {
    reviewers: { codex: { enabled: false } },
    lenses: [{ id: 'scope', enabled: false }, { id: 'containment', title: 'Containment', lens: 'A guest reaching the host.' }],
  } } } })
  const briefFile = path.join(dir, '.brigade', 'brief.md')
  const findings = path.join(dir, '.brigade', 'find.txt')
  const env = { PATH: stubPath(dir, ['codex', 'claude', 'agent']) }
  const p = JSON.parse(pr(dir, ['redteam', '--brief', briefFile, '--findings', findings, '--json'], env).out)
  assert.deepEqual(p.skipped, [{ tool: 'codex', reason: 'switched off' }])
  assert.equal(p.find.tool, 'cursor')
  assert.equal(p.verify.tool, 'claude')
  assert.ok(p.verify.command.includes(`Read ${briefFile}.`), p.verify.command)
  assert.ok(p.verify.command.includes(`each finding in ${findings}`), p.verify.command)
  assert.ok(p.verify.command.includes(`git diff main...${head}`), p.verify.command)
  const text = fs.readFileSync(briefFile, 'utf8')
  assert.match(text, /- Containment\. A guest reaching the host\./)
  assert.doesNotMatch(text, /- Scope\./)
  assert.match(text, /error\[review:rule-name\]/)
})
