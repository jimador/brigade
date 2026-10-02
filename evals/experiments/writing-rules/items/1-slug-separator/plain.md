# Packet: slug-separator — slugify takes a separator option

- **files:** the ONLY files you may touch
  - src/slug.js (edit)
  - test/slug.test.js (edit)

### Goal

`slugify(title, options)` accepts an optional `options.separator` so callers can join the words of a slug with something other than a dash (the export code wants slugs like `release_notes_v2`), while a call without options returns exactly the slug it returns today.

### Contracts you code against

```js
// src/slug.js after this change
slugify(title: string, options?: { separator?: string }): string
```

The separator is `options.separator` and defaults to `'-'` when `options` or `options.separator` is undefined; it may be longer than one character (`'--'` gives `hello--world`) and takes the dash's place everywhere the dash appears today, so `slugify('  Release notes: v2! ', { separator: '_' })` returns `release_notes_v2`. A separator that is not a non-empty string (for example `''` or `5`) makes `slugify` throw `new TypeError('separator must be a non-empty string')`.

### Current behavior (pasted anchors)

```js
// src/slug.js
function slugify(title) {
  return String(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .join('-')
}

module.exports = { slugify }
```

### Steps

1. **Explore (read-only, 2 files):** read `src/slug.js` and `test/slug.test.js`; if either doesn't match what's pasted above, stop and report the difference in your final message rather than improvising.
2. **Implement:** add the `options` parameter and the separator check to `slugify` in `src/slug.js`, keep the comment above the function accurate, and export only `slugify`.
3. **Implement:** add cases to `test/slug.test.js` for the `'_'` separator, a two-character separator, the default when `options` is `{}`, and the `TypeError` for an empty separator.
4. **Verify (must pass):** run this from the repo root, fix and rerun until it exits 0, and if you can't get it to pass, stop and report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] `slugify('Hello World', { separator: '_' })` returns `hello_world`
- [ ] `slugify('Hello World')` and `slugify('Hello World', {})` return `hello-world`
- [ ] `slugify('Hello World', { separator: '' })` throws a `TypeError` with the message `separator must be a non-empty string`
- [ ] `node --test` exits 0 with the new cases in it

### Conventions

CommonJS (`require` and `module.exports`), no dependencies, tests on `node:test` with `node:assert/strict` like the existing ones, and comments that say what the code does in plain words.

### Out of scope

Every other file, other slug rules (accents, a length limit), and `package.json`.
