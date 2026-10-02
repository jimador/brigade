# Packet: slug-separator

- **files:** Change only the files in this list.
  - `src/slug.js` (edit)
  - `test/slug.test.js` (edit)

### Goal

The function `slugify(title, options)` accepts an optional separator.
The separator is the text that joins the words of a slug.
Callers need a separator other than a dash, because the export code needs slugs like `release_notes_v2`.
A call without options returns the same slug as today.

### Contracts you code against

```js
// src/slug.js after this change
slugify(title: string, options?: { separator?: string }): string
```

- The separator is `options.separator`.
- If `options` is undefined, the separator MUST be `'-'`.
- If `options.separator` is undefined, the separator MUST be `'-'`.
- The separator MAY have more than one character. For example, the separator `'--'` gives `hello--world`.
- The separator MUST replace the dash in each place where `slugify` puts a dash today.
- For example, `slugify('  Release notes: v2! ', { separator: '_' })` returns `release_notes_v2`.
- If the separator is not a non-empty string, `slugify` MUST throw `new TypeError('separator must be a non-empty string')`.
- Two examples of a bad separator are `''` and `5`.

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

1. **Explore (read-only, 2 files):**
   - Read `src/slug.js` and `test/slug.test.js`.
   - If a file does not match the code above, stop the work.
   - Report the difference in your final message instead of a guess.
2. **Implement:**
   - Add the `options` parameter to `slugify` in `src/slug.js`.
   - Add the check for a bad separator to `slugify`.
   - Keep the comment above `slugify` accurate.
   - Export only `slugify`.
3. **Implement:** Add these cases to `test/slug.test.js`:
   - Test the separator `'_'`.
   - Test a separator with two characters.
   - Test the default separator when `options` is `{}`.
   - Test the `TypeError` for an empty separator.
4. **Verify (must pass):**
   - Run the command below from the root of the repo.
   - If the command fails, fix the code.
   - Then run the command again.
   - Continue until the command exits 0.
   - If you cannot make the command pass, stop the work.
   - Report the failing output in your final message.

```bash
node --test
```

### Acceptance criteria

- [ ] `slugify('Hello World', { separator: '_' })` returns `hello_world`.
- [ ] `slugify('Hello World')` returns `hello-world`.
- [ ] `slugify('Hello World', {})` returns `hello-world`.
- [ ] `slugify('Hello World', { separator: '' })` throws a `TypeError`.
- [ ] The message of the `TypeError` is `separator must be a non-empty string`.
- [ ] `node --test` exits 0.
- [ ] The output of `node --test` includes the new cases.

### Conventions

- Use CommonJS modules, with `require` and `module.exports`.
- Add no dependencies.
- Write the tests with `node:test` and `node:assert/strict`, like the existing tests.
- Write comments that say what the code does, in plain words.

### Out of scope

- Change no other file.
- Add no other slug rules, such as accents or a length limit.
- Leave `package.json` unchanged.
