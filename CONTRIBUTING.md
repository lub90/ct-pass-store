# Contributing to CtPassStore

Developer notes for working on this repository. For what CtPassStore is and how to set it up, see
[`README.md`](README.md); for the extension's development setup, see
[`extension/docs/development.md`](extension/docs/development.md).

## Pre-commit check (secrets and private terms)

A repository hook refuses commits that add private or secret values. Enable it once per clone (no npm or composer
needed; it only sets `core.hooksPath` in the clone's `.git/config`):

```sh
sh scripts/install-hooks.sh      # or: git config core.hooksPath .githooks
```

`.githooks/pre-commit` runs `node scripts/check-private.mjs`, which checks **only the lines added in the staged diff**
(and the paths of the staged files) against:

- the local, gitignored block list **`.private-terms`** at the repository root: copy `.private-terms.example` and
  list one term per line (`#` comments; case-insensitive; spaces, dots, hyphens and underscores inside a term match any
  such separators or none). Intended occurrences get a path exception: `Some Term ## allow: LICENSE, specs/*.md`
  (globs on the repo-relative path; `*` within a directory, `**` across). Worth listing: the church's name and
  abbreviations, real person names, ChurchTools instance host names, e-mail addresses, phone numbers, addresses;
- the values in your local credential files, if present: `extension/.env` and `extension/.env.*` (values of 6 or
  more characters, plus the host name of URL values), the `<env value>`s of `backend/phpunit.xml`, and the
  pwd/password/token/secret/username fields of `backend/tests/Contract/fixtures/*.json`.

In a linked worktree (`git worktree add` doesn't copy these gitignored files), the block list is the worktree's own
`.private-terms` if it has one, else the main checkout's; the credential files are read from both.

Harmless words that coincide with such values (`ctpassstore`, `churchtools`) never block. A hit prints only
`<file>:<line>: matches <source> entry #<n>` (the term's line in `.private-terms`, or the key and line in the credential
file), **never the value**; the commit is refused. Without `.private-terms` the hook prints a one-line hint and still
checks the credential files. If a `gitleaks` binary is on `PATH`, the hook also runs it on the staged changes with
`.gitleaks.toml` and `--redact`; otherwise it prints a one-line hint (CI runs gitleaks on the whole history anyway).

Other modes: `node scripts/check-private.mjs --range main..HEAD` (every line added by every commit in the range, also
lines a later commit removed again, and the lines a merge commit adds itself; see "Merge commits" below) and `--all`
(every tracked file). Tests: `node --test 'scripts/*.test.mjs'` (also run in CI, `.github/workflows/extension.yml`, job
`private-check`).

### Merge commits

In `--range` mode, a merge commit is read as a combined diff (`git log --cc`). Only the lines the merge adds against
every parent are its own (for example a conflict resolution) and are checked under the merge commit. Lines that come
from a parent are checked in that parent's commit when it is in the range, not again under the merge.

### Known gaps

- **Content of binary files:** this script doesn't check it. A file with a NUL byte shows up in a diff only as
  `Binary files differ`, and `--all` skips files with a NUL byte in their first 8000 bytes. Only gitleaks scans such
  content: in CI, or locally in the hook if a `gitleaks` binary is installed. The **paths** of binary files, like those
  of empty files and of renamed files, are still checked against the block list and the credential values: in
  `--staged` and `--range` mode from the `diff --git` (or `diff --cc`) header, in `--all` mode from `git ls-files`.
  The path of a deleted file is not a hit; the path of a file whose mode alone changes (e.g. `chmod +x`) is.

### Emergency bypass

`git commit --no-verify` skips the hook. It should be rare and deliberate: prefer fixing the line or adding a reviewed
`## allow:` exception; never bypass for a real credential.
