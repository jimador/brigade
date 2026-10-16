// Applies one mutant to a fixture copy. A mutant is a JSON file holding
// { "file": "src/x.js", "why": "...", "edits": [{ "find": "...", "replace": "..." }] }.
// Each find string must occur exactly once in the file, so a mutant that no longer
// matches the source fails loudly instead of silently testing the original.
// Usage: node mutate.js <mutant.json> <fixture root>
const fs = require('node:fs')
const path = require('node:path')

const [mutantPath, root] = process.argv.slice(2)
if (!mutantPath || !root) {
  console.error('usage: node mutate.js <mutant.json> <fixture root>')
  process.exit(2)
}
const mutant = JSON.parse(fs.readFileSync(mutantPath, 'utf8'))
const target = path.join(root, mutant.file)
let source = fs.readFileSync(target, 'utf8')
for (const edit of mutant.edits) {
  const count = source.split(edit.find).length - 1
  if (count !== 1) {
    console.error(`${path.basename(mutantPath)}: find string occurs ${count} times in ${mutant.file}`)
    process.exit(1)
  }
  source = source.replace(edit.find, () => edit.replace)
}
fs.writeFileSync(target, source)
