// Tests of the pre-commit privacy and secrets check (scripts/check-private.mjs, .githooks/pre-commit,
// scripts/install-hooks.sh). Run: `node --test 'scripts/*.test.mjs'` from the repository root (also in CI,
// extension.yml).
//
// Every term and credential value below is INVENTED. They are deliberately low-entropy so that the repository's own
// gitleaks scan doesn't take them for real secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'check-private.mjs');
const INSTALL = join(HERE, 'install-hooks.sh');
const HOOK = join(HERE, '..', '.githooks', 'pre-commit');

// Isolate from the developer's git configuration (signing, hooksPath, templates, ...).
const baseEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.test',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.test',
};

// Invented values, one per source type.
const V = {
  term1: 'Zebra-Zebra-Pass',
  term2: 'quillquill',
  envPassword: 'pass-pass-pass-zz',
  envUser: 'aliceali@example.test',
  envShort: 'abab1',
  envHost: 'inventedinvented.example.test',
  envLocal: 'locallocal-zz',
  phpToken: 'tokentoken-zz',
  fixturePwd: 'fixfix-pwpw-pw',
  fixtureUser: 'bobbob-user',
  fixtureNested: 'nestnest-tok',
  fixturePlain: 'plainplain-zz',
};
const ALL_VALUES = Object.values(V);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: baseEnv, encoding: 'utf8' });
}

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function makeRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'check-private-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, '.gitignore', '.private-terms\nextension/.env\nextension/.env.*\nbackend/phpunit.xml\nbackend/tests/Contract/fixtures/\n');
  write(repo, 'README.md', 'start\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

function blockList(repo, lines) {
  write(repo, '.private-terms', lines.join('\n') + '\n');
}

function check(repo, args = [], env = baseEnv) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

function stage(repo, path, content) {
  write(repo, path, content);
  git(repo, 'add', path);
}

function assertNoValues(text) {
  const lower = text.toLowerCase();
  for (const v of ALL_VALUES) assert.ok(!lower.includes(v.toLowerCase()), 'a protected value appeared in the output');
}

// Full set of credential files with every invented value.
function credentialFiles(repo) {
  write(
    repo,
    'extension/.env',
    [
      '# comment line',
      `VITE_KEY=ctpassstore`,
      `VITE_BASE_URL=https://${V.envHost}/`,
      `VITE_USERNAME="${V.envUser}"`,
      `VITE_PASSWORD='${V.envPassword}'`,
      `VITE_SHORT=${V.envShort}`,
      '',
    ].join('\n'),
  );
  write(repo, 'extension/.env.local', `VITE_OTHER=${V.envLocal}\n`);
  write(
    repo,
    'backend/phpunit.xml',
    [
      '<phpunit><php>',
      '  <env name="CT_API_URL" value="https://churchtools.example.test"/>',
      `  <env value="${V.phpToken}" name="CT_API_TOKEN" />`,
      '</php></phpunit>',
      '',
    ].join('\n'),
  );
  write(
    repo,
    'backend/tests/Contract/fixtures/admin_users.json',
    JSON.stringify([{ id: 1, username: V.fixtureUser, pwd: V.fixturePwd, name: V.fixturePlain }], null, 2),
  );
  write(
    repo,
    'backend/tests/Contract/fixtures/other.json',
    JSON.stringify({ auth: { apiToken: V.fixtureNested, count: 123456789 } }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Staged mode (default)

test('staged addition without hits: exit 0 and no output at all', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  credentialFiles(repo);
  stage(repo, 'notes.txt', 'harmless line\nanother one\n');
  const r = check(repo);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(r.err, '');
});

test('nothing staged: exit 0 quietly', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  const r = check(repo, ['--staged']);
  assert.equal(r.code, 0);
  assert.equal(r.all, '');
});

test('block-list hit: exit 1, file, line and entry number only, never the term', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['# people', '', V.term1, V.term2]);
  stage(repo, 'notes.txt', `first\nwe met at ${V.term2} yesterday\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'notes.txt:2: matches block list entry #4\n');
  assertNoValues(r.all);
});

test('block list matches case-insensitively', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', `x ${V.term1.toUpperCase()} y\nz ${V.term1.toLowerCase()}\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches block list entry #1\na.txt:2: matches block list entry #1\n');
  assertNoValues(r.all);
});

test('comment lines and blank lines of the block list are not terms; terms are trimmed', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['# commentcomment', '   ', `   ${V.term2}   `]);
  stage(repo, 'a.txt', 'commentcomment\n# commentcomment\n');
  assert.equal(check(repo).code, 0);
  stage(repo, 'b.txt', `${V.term2}\n`);
  assert.equal(check(repo).out, 'b.txt:1: matches block list entry #3\n');
});

test('only added lines are checked, with correct new-file line numbers across hunks', (t) => {
  const repo = makeRepo(t);
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  lines[4] = `old ${V.term1}`; // already committed, unchanged: not reported
  lines[19] = `remove ${V.term2}`; // removed below: not reported
  write(repo, 'big.txt', lines.join('\n') + '\n');
  git(repo, 'add', 'big.txt');
  git(repo, 'commit', '-q', '-m', 'base');
  blockList(repo, [V.term1, V.term2]);

  const next = [...lines];
  next[1] = `changed ${V.term2}`; // line 2
  next.splice(19, 1); // removes the old line 20
  next.splice(25, 0, `added ${V.term1}`); // becomes line 26
  stage(repo, 'big.txt', next.join('\n') + '\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'big.txt:2: matches block list entry #2\nbig.txt:26: matches block list entry #1\n');
});

test('"\\ No newline at end of file" markers do not shift the line numbers', (t) => {
  const repo = makeRepo(t);
  write(repo, 'n.txt', 'a\nb'); // no newline at the end
  git(repo, 'add', 'n.txt');
  git(repo, 'commit', '-q', '-m', 'no newline');
  blockList(repo, [V.term1]);
  stage(repo, 'n.txt', `a\nnew\n${V.term1}`); // replaces the last line, again without a newline
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'n.txt:3: matches block list entry #1\n');
});

test('unstaged changes are not checked in staged mode', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', 'clean\n');
  write(repo, 'a.txt', `clean\n${V.term1}\n`); // modified in the work tree only
  assert.equal(check(repo).code, 0);
});

test('a file path that contains a term is reported without printing the path', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term2]);
  stage(repo, `docs/${V.term2}-notes.txt`, 'clean content\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, '(path withheld): file path matches block list entry #1\n');
  assertNoValues(r.all);
});

// Git prints no "+++" header for empty files, binary files and renames of them; their paths are checked anyway.
const PATH_HIT = '(path withheld): file path matches block list entry #1\n';

test('the path of an empty new file is checked (unquoted, with spaces and non-ASCII)', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term2]);
  stage(repo, `d/ä ${V.term2} empty.txt`, '');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, PATH_HIT);
  assertNoValues(r.all);
});

test('the path of a binary file is checked', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term2]);
  write(repo, `d/${V.term2} scan.bin`, Buffer.from([0, 1, 2, 0, 3]));
  git(repo, 'add', '.');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, PATH_HIT);
  assertNoValues(r.all);
});

test('a pure rename of an empty file into a path that contains a term is reported', (t) => {
  const repo = makeRepo(t);
  write(repo, 'e/plain.txt', '');
  git(repo, 'add', 'e/plain.txt');
  git(repo, 'commit', '-q', '-m', 'empty');
  blockList(repo, [V.term2]);
  git(repo, 'mv', 'e/plain.txt', `e/${V.term2}-moved.txt`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, PATH_HIT);
  assertNoValues(r.all);
});

test('deleting a file whose path contains a term is not a hit', (t) => {
  const repo = makeRepo(t);
  write(repo, `e/${V.term2}.txt`, 'content\n');
  write(repo, `e/${V.term2}-empty.txt`, '');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'files');
  blockList(repo, [V.term2]);
  git(repo, 'rm', '-q', `e/${V.term2}.txt`, `e/${V.term2}-empty.txt`);
  const r = check(repo);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('a pure rename into a path that contains a term is reported (no rename detection)', (t) => {
  const repo = makeRepo(t);
  write(repo, 'docs/plain.txt', 'clean content\n');
  git(repo, 'add', 'docs/plain.txt');
  git(repo, 'commit', '-q', '-m', 'plain');
  blockList(repo, [V.term2]);
  git(repo, 'mv', 'docs/plain.txt', `docs/${V.term2}.txt`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, '(path withheld): file path matches block list entry #1\n');
  assertNoValues(r.all);
});

test('quoted paths (non-ASCII, tab) are unquoted: path terms and allow globs see the real path', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['Müllmüll', `${V.term1} ## allow: docs/*.md`]);
  stage(repo, 'notes/Müllmüll.txt', 'clean content\n');
  stage(repo, 'docs/ä-notes.md', `${V.term1}\n`); // allowed
  stage(repo, 'docs/tab\there.md', `${V.term1}\n`); // allowed
  stage(repo, 'other/ö\tö.txt', `${V.term1}\n`); // not allowed: reported under its real name
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, '(path withheld): file path matches block list entry #1\nother/ö\tö.txt:1: matches block list entry #2\n');
  assertNoValues(r.all);
  assert.doesNotMatch(r.all, /müll/i);
});

test('separators inside a term match any run of separators or none', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['zq   kx', 'ab-cd.ef']);
  const variants = ['zq kx', 'zq-kx', 'ZQ_KX', 'zq.kx', 'zqkx', 'Zq - _ Kx', 'zq--kx'];
  stage(repo, 'a.txt', variants.join('\n') + '\nabcdef\nAB_CD EF\nab cd\nzq/kx\nzq\tkx\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  const expected = variants.map((_, i) => `a.txt:${i + 1}: matches block list entry #1`);
  expected.push('a.txt:8: matches block list entry #2', 'a.txt:9: matches block list entry #2', 'a.txt:12: matches block list entry #1');
  assert.equal(r.out, expected.join('\n') + '\n');
  assert.doesNotMatch(r.all, /zq|kx|ab.?cd/i);
});

test('separator-flexible matching keeps the letters in order and contiguous', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['zq kx']);
  stage(repo, 'a.txt', 'zq x kx\nzqa kx\nkx zq\n');
  assert.equal(check(repo).code, 0);
});

test('"## allow:" path exceptions ignore hits in matching paths only', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [`${V.term1} ## allow: LICENSE, src/i18n/*.ts, specs/*.md`, V.term2]);
  stage(repo, 'LICENSE', `Copyright ${V.term1}\n`);
  stage(repo, 'src/i18n/de.ts', `x ${V.term1}\n`);
  stage(repo, 'specs/spec.md', `${V.term1}\n`);
  stage(repo, 'specs/sub/deep.md', `${V.term1}\n`); // * doesn't cross /
  stage(repo, 'src/i18n/de.js', `${V.term1}\n`);
  stage(repo, 'docs/LICENSE', `${V.term1}\n`); // anchored at the repository root
  stage(repo, 'src/i18n/en.ts', `${V.term2}\n`); // the exception belongs to term 1 only
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    [
      'docs/LICENSE:1: matches block list entry #1',
      'specs/sub/deep.md:1: matches block list entry #1',
      'src/i18n/de.js:1: matches block list entry #1',
      'src/i18n/en.ts:1: matches block list entry #2',
      '',
    ].join('\n'),
  );
  assertNoValues(r.all);
});

test('"**" in an allow pattern crosses directories; the exception text is not part of the term', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [`${V.term2}   ##   allow:   docs/**   `]);
  stage(repo, 'docs/a/b/c.md', `${V.term2}\n`);
  stage(repo, 'x.txt', 'allow: docs/**\n');
  assert.equal(check(repo).code, 0);
  stage(repo, 'y.txt', `${V.term2}\n`);
  assert.equal(check(repo).out, 'y.txt:1: matches block list entry #1\n');
});

test('"**/" in an allow pattern also matches zero directories', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [`${V.term2} ## allow: docs/**/x.md`]);
  stage(repo, 'docs/x.md', `${V.term2}\n`);
  stage(repo, 'docs/a/b/x.md', `${V.term2}\n`);
  assert.equal(check(repo).code, 0);
  stage(repo, 'docs/y.md', `${V.term2}\n`);
  stage(repo, 'docsx.md', `${V.term2}\n`);
  assert.equal(check(repo).out, 'docs/y.md:1: matches block list entry #1\ndocsx.md:1: matches block list entry #1\n');
});

test('--all reports every hit with its entry number, also in allowed and other files', (t) => {
  const repo = makeRepo(t);
  write(repo, 'LICENSE', `${V.term1}\n`);
  write(repo, 'a.txt', `${V.term1}\n${V.term2} ${V.term1}\n`);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'files');
  blockList(repo, [`${V.term1} ## allow: LICENSE`, V.term2]);
  const r = check(repo, ['--all']);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    'a.txt:1: matches block list entry #1\na.txt:2: matches block list entry #1\na.txt:2: matches block list entry #2\n',
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Credential files as sources

test('extension/.env values are blocked, labelled by key name; values shorter than 6 chars are ignored', (t) => {
  const repo = makeRepo(t);
  blockList(repo, []);
  credentialFiles(repo);
  stage(repo, 'a.txt', [`u=${V.envUser}`, `p=${V.envPassword}`, `s=${V.envShort}`, ''].join('\n'));
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    'a.txt:1: matches extension/.env VITE_USERNAME entry #4\na.txt:2: matches extension/.env VITE_PASSWORD entry #5\n',
  );
  assertNoValues(r.all);
});

test('extension/.env.* files are sources too', (t) => {
  const repo = makeRepo(t);
  blockList(repo, []);
  credentialFiles(repo);
  stage(repo, 'a.txt', `x ${V.envLocal.toUpperCase()}\n`);
  const r = check(repo);
  assert.equal(r.out, 'a.txt:1: matches extension/.env.local VITE_OTHER entry #1\n');
});

test('an extension/.env value of exactly 6 characters is blocked', (t) => {
  const repo = makeRepo(t);
  write(repo, 'extension/.env', 'VITE_SIX=sixsix\nVITE_FIVE=fivef\n');
  stage(repo, 'a.txt', 'x sixsix y\nfivef\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches extension/.env VITE_SIX entry #1\n');
  assert.doesNotMatch(r.all, /sixsix/);
});

test('extension/.env: "export KEY=value" lines and unquoted values with a trailing " # comment" are read', (t) => {
  const repo = makeRepo(t);
  write(repo, 'extension/.env', 'export VITE_EXPORTED=exportexport-zz\nVITE_NOTED=notednoted-zz   # a note\n');
  stage(repo, 'a.txt', 'exportexport-zz\nnotednoted-zz\nzz   # a note\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    'a.txt:1: matches extension/.env VITE_EXPORTED entry #1\na.txt:2: matches extension/.env VITE_NOTED entry #2\n',
  );
  assert.doesNotMatch(r.all, /exportexport|notednoted/);
});

test('backend/phpunit.xml values are XML-decoded before matching', (t) => {
  const repo = makeRepo(t);
  write(
    repo,
    'backend/phpunit.xml',
    '<phpunit><php>\n  <env name="CT_ONE" value="ampamp&amp;zz&#45;zz"/>\n  <env name=\'CT_TWO\' value=\'hexhex&#x2D;&lt;zz&gt;\'/>\n</php></phpunit>\n',
  );
  stage(repo, 'a.txt', 'ampamp&zz-zz\nhexhex-<zz>\nampamp&amp;zz&#45;zz\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches backend/phpunit.xml CT_ONE entry #2\na.txt:2: matches backend/phpunit.xml CT_TWO entry #3\n');
  assert.doesNotMatch(r.all, /ampamp|hexhex/);
});

test('a value found in two sources is reported once, under the first source', (t) => {
  const repo = makeRepo(t);
  write(repo, 'extension/.env', 'VITE_PASSWORD=dupdup-zz\n');
  write(repo, 'backend/phpunit.xml', '<phpunit><php>\n  <env name="CT_PASSWORD" value="DupDup-ZZ"/>\n</php></phpunit>\n');
  stage(repo, 'a.txt', 'dupdup-zz\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches extension/.env VITE_PASSWORD entry #1\n');
});

test('the host name of a URL value is blocked on its own', (t) => {
  const repo = makeRepo(t);
  blockList(repo, []);
  credentialFiles(repo);
  stage(repo, 'a.txt', `see ${V.envHost} for details\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches extension/.env VITE_BASE_URL (host) entry #3\n');
  assertNoValues(r.all);
});

test('backend/phpunit.xml env values are blocked, labelled by variable name (any attribute order)', (t) => {
  const repo = makeRepo(t);
  blockList(repo, []);
  credentialFiles(repo);
  stage(repo, 'a.txt', `token: ${V.phpToken}\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches backend/phpunit.xml CT_API_TOKEN entry #3\n');
  assertNoValues(r.all);
});

test('contract fixture credential fields are blocked by field path; other fields are not', (t) => {
  const repo = makeRepo(t);
  blockList(repo, []);
  credentialFiles(repo);
  stage(repo, 'a.txt', [V.fixtureUser, V.fixturePwd, V.fixtureNested, V.fixturePlain, '123456789', ''].join('\n'));
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    [
      'a.txt:1: matches backend/tests/Contract/fixtures/admin_users.json [0].username entry #1',
      'a.txt:2: matches backend/tests/Contract/fixtures/admin_users.json [0].pwd entry #2',
      'a.txt:3: matches backend/tests/Contract/fixtures/other.json auth.apiToken entry #1',
      '',
    ].join('\n'),
  );
  assertNoValues(r.all);
});

test('an unreadable fixture gives a one-line note without its content and the check goes on', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  write(repo, 'backend/tests/Contract/fixtures/broken.json', `{"pwd": "${V.fixturePwd}", oops`);
  stage(repo, 'a.txt', `${V.term1}\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches block list entry #1\n');
  assert.equal(r.err.split('\n').filter(Boolean).length, 1);
  assert.match(r.err, /broken\.json/);
  assertNoValues(r.all);
});

test('the credential files themselves are never printed even when every source hits', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1, V.term2]);
  credentialFiles(repo);
  stage(repo, 'all.txt', ALL_VALUES.join('\n') + '\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assertNoValues(r.all);
  for (const line of r.out.split('\n').filter(Boolean)) {
    assert.match(line, /^all\.txt:\d+: matches .+ entry #\d+$/);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Allowlist

test('allowlisted words never block, even when a credential value or term equals them', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['churchtools', 'CtPassStore']);
  credentialFiles(repo); // VITE_KEY=ctpassstore
  stage(repo, 'a.txt', 'the ChurchTools extension ctpassstore\n');
  const r = check(repo);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('a term inside an allowlisted word does not block, the same term elsewhere does', (t) => {
  const repo = makeRepo(t);
  blockList(repo, ['hurchtool']);
  stage(repo, 'a.txt', 'churchtools\n');
  assert.equal(check(repo).code, 0);
  stage(repo, 'b.txt', 'churchtools and hurchtoolx\n');
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'b.txt:1: matches block list entry #1\n');
});

test('a term next to an allowlisted word still blocks', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term2]);
  stage(repo, 'a.txt', `churchtools-${V.term2}\n`);
  assert.equal(check(repo).out, 'a.txt:1: matches block list entry #1\n');
});

// ---------------------------------------------------------------------------------------------------------------
// Missing block list

test('missing block list: a one-line hint on stderr, not an error', (t) => {
  const repo = makeRepo(t);
  stage(repo, 'a.txt', 'clean\n');
  const r = check(repo);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  const lines = r.err.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\.private-terms/);
  assert.doesNotMatch(lines[0], /error/i);
});

test('missing block list: credential-file values are still checked', (t) => {
  const repo = makeRepo(t);
  credentialFiles(repo);
  stage(repo, 'a.txt', `${V.phpToken}\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches backend/phpunit.xml CT_API_TOKEN entry #3\n');
});

// ---------------------------------------------------------------------------------------------------------------
// Linked worktrees: `git worktree add` doesn't copy the gitignored local files, so they come from the main checkout

function makeWorktree(t, repo) {
  const parent = mkdtempSync(join(tmpdir(), 'check-private-wt-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const wt = join(parent, 'wt');
  git(repo, 'worktree', 'add', '-q', '--detach', wt);
  return wt;
}

test('linked worktree: the block list and the credential files of the main checkout are used', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  credentialFiles(repo);
  const wt = makeWorktree(t, repo);
  assert.ok(!existsSync(join(wt, '.private-terms')) && !existsSync(join(wt, 'extension')));
  stage(wt, 'a.txt', `${V.term1}\n${V.envPassword}\n`);
  const r = check(wt);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches block list entry #1\na.txt:2: matches extension/.env VITE_PASSWORD entry #5\n');
  assert.equal(r.err, '');
  assertNoValues(r.all);
});

test("linked worktree: the worktree's own block list wins over the main checkout's", (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  credentialFiles(repo);
  const wt = makeWorktree(t, repo);
  blockList(wt, ['# own list', V.term2]);
  stage(wt, 'a.txt', `${V.term1}\n${V.term2}\n${V.phpToken}\n`);
  const r = check(wt);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:2: matches block list entry #2\na.txt:3: matches backend/phpunit.xml CT_API_TOKEN entry #3\n');
  assertNoValues(r.all);
});

test("linked worktree: the worktree's own extension/.env wins over the main checkout's credential files", (t) => {
  const repo = makeRepo(t);
  credentialFiles(repo);
  const wt = makeWorktree(t, repo);
  write(wt, 'extension/.env', 'VITE_PASSWORD=ownown-wt-zz\n');
  stage(wt, 'a.txt', `ownown-wt-zz\n${V.envPassword}\n`);
  const r = check(wt);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches extension/.env VITE_PASSWORD entry #1\n');
  assert.doesNotMatch(r.all, /ownown/);
  assertNoValues(r.all);
});

test('linked worktree: a main checkout with only backend/phpunit.xml is used', (t) => {
  const repo = makeRepo(t);
  write(repo, 'backend/phpunit.xml', '<phpunit><php>\n  <env name="CT_API_TOKEN" value="phponly-zz"/>\n</php></phpunit>\n');
  const wt = makeWorktree(t, repo);
  stage(wt, 'a.txt', 'phponly-zz\n');
  const r = check(wt);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches backend/phpunit.xml CT_API_TOKEN entry #2\n');
  assert.doesNotMatch(r.all, /phponly/);
});

test('linked worktree: a main checkout with only contract fixtures is used', (t) => {
  const repo = makeRepo(t);
  write(repo, 'backend/tests/Contract/fixtures/users.json', JSON.stringify({ pwd: 'fixonly-zz' }));
  const wt = makeWorktree(t, repo);
  stage(wt, 'a.txt', 'fixonly-zz\n');
  const r = check(wt);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches backend/tests/Contract/fixtures/users.json pwd entry #1\n');
  assert.doesNotMatch(r.all, /fixonly/);
});

test('linked worktree: credential sources are chosen one by one (own .env, phpunit.xml from the main checkout)', (t) => {
  const repo = makeRepo(t);
  write(repo, 'extension/.env', 'VITE_PASSWORD=mainenv-zz\n');
  write(repo, 'backend/phpunit.xml', '<phpunit><php>\n  <env name="CT_API_TOKEN" value="mainphp-zz"/>\n</php></phpunit>\n');
  const wt = makeWorktree(t, repo);
  write(wt, 'extension/.env', 'VITE_PASSWORD=wtenv-zz\n');
  stage(wt, 'a.txt', 'wtenv-zz\nmainenv-zz\nmainphp-zz\n');
  const r = check(wt);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    'a.txt:1: matches extension/.env VITE_PASSWORD entry #1\na.txt:3: matches backend/phpunit.xml CT_API_TOKEN entry #2\n',
  );
  assert.doesNotMatch(r.all, /wtenv|mainenv|mainphp/);
});

// ---------------------------------------------------------------------------------------------------------------
// Range mode

test('--range checks every commit in the range, also lines a later commit removed again', (t) => {
  const repo = makeRepo(t);
  write(repo, 'old.txt', `${V.term1}\n`); // on main before the branch: outside the range
  git(repo, 'add', 'old.txt');
  git(repo, 'commit', '-q', '-m', 'old');
  git(repo, 'checkout', '-q', '-b', 'feature');
  write(repo, 'f.txt', `a\n${V.term2}\n`);
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'add');
  const first = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  write(repo, 'f.txt', 'a\n');
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'remove');
  blockList(repo, [V.term1, V.term2]);

  const r = check(repo, ['--range', 'main..HEAD']);
  assert.equal(r.code, 1);
  assert.equal(r.out, `f.txt:2: matches block list entry #2 (commit ${first})\n`);
  assertNoValues(r.all);
});

test('--range without hits exits 0 quietly', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  git(repo, 'checkout', '-q', '-b', 'feature');
  write(repo, 'f.txt', 'clean\n');
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'clean');
  const r = check(repo, ['--range', 'main..HEAD']);
  assert.equal(r.code, 0);
  assert.equal(r.all, '');
});

test('--range with an unknown revision is a usage error (exit 2)', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  const r = check(repo, ['--range', 'nope..HEAD']);
  assert.equal(r.code, 2);
});

test('--range with an unknown revision is exit 2 also without any sources (as in CI)', (t) => {
  const repo = makeRepo(t);
  const r = check(repo, ['--range', 'nope..HEAD']);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.match(r.err, /check-private: git rev-list failed/);
});

test("--range checks a merge commit's own changes, not again the lines it takes from its parents", (t) => {
  const repo = makeRepo(t);
  write(repo, 'f.txt', 'a\nb\nc\n');
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'feature');
  write(repo, 'f.txt', `a\nb\nc\nfeature ${V.term1}\n`);
  git(repo, 'commit', '-q', '-am', 'feature');
  const feature = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'g.txt', `main ${V.term1}\n`);
  git(repo, 'add', 'g.txt');
  git(repo, 'commit', '-q', '-m', 'main');
  const mainCommit = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'feature');
  // Changes of the merge itself, in two files; each merged line sits next to a line from a parent: from the feature
  // parent in f.txt ("+ "), from main in g.txt (" +").
  write(repo, 'f.txt', `a\nb\nc\nmerged ${V.term2}\nfeature ${V.term1}\n`);
  write(repo, 'g.txt', `main ${V.term1}\nmerged ${V.term2}\n`);
  git(repo, 'add', 'f.txt', 'g.txt');
  git(repo, 'commit', '-q', '-m', 'merge');
  const merge = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  blockList(repo, [V.term1, V.term2]);
  const r = check(repo, ['--range', `${base}..HEAD`]);
  assert.equal(r.code, 1);
  // The two parents' commits may come in either order (same timestamp); the merge comes last.
  const lines = r.out.split('\n').filter(Boolean);
  assert.deepEqual(lines.slice(0, 2).sort(), [
    `f.txt:4: matches block list entry #1 (commit ${feature})`,
    `g.txt:1: matches block list entry #1 (commit ${mainCommit})`,
  ].sort());
  assert.deepEqual(lines.slice(2), [
    `f.txt:4: matches block list entry #2 (commit ${merge})`,
    `g.txt:2: matches block list entry #2 (commit ${merge})`,
  ]);
  assertNoValues(r.all);
});

test('--range reads the combined diff of an octopus merge (three parents)', (t) => {
  const repo = makeRepo(t);
  write(repo, 'f.txt', 'a\nb\nc\n');
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'one');
  write(repo, 'one.txt', 'one\n');
  git(repo, 'add', 'one.txt');
  git(repo, 'commit', '-q', '-m', 'one');
  git(repo, 'checkout', '-q', '-b', 'two', base);
  write(repo, 'f.txt', `a\nb\nc\ntwo ${V.term1}\n`);
  git(repo, 'commit', '-q', '-am', 'two');
  const two = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'one', 'two');
  // The merge's own line sits next to the line from the third parent ("++ ").
  write(repo, 'f.txt', `a\nb\nc\nmerged ${V.term2}\ntwo ${V.term1}\n`);
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'octopus');
  const merge = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  assert.equal(git(repo, 'rev-list', '--parents', '-1', 'HEAD').trim().split(' ').length, 4, 'three parents');
  blockList(repo, [V.term1, V.term2]);
  const r = check(repo, ['--range', `${base}..HEAD`]);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    `f.txt:4: matches block list entry #1 (commit ${two})\nf.txt:4: matches block list entry #2 (commit ${merge})\n`,
  );
  assertNoValues(r.all);
});

test('a failing git command is named by its subcommand, not by its leading -c options', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  write(repo, 'broken-index', 'not an index\n');
  const r = check(repo, [], { ...baseEnv, GIT_INDEX_FILE: join(repo, 'broken-index') });
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.equal(r.err, 'check-private: git diff failed\n');
});

test('--range checks the path of a binary file, once per commit', (t) => {
  const repo = makeRepo(t);
  git(repo, 'checkout', '-q', '-b', 'feature');
  write(repo, `${V.term2}-photo.png`, Buffer.from([0x89, 0x50, 0, 0, 1]));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'photo');
  const first = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  write(repo, `${V.term2}-photo.png`, Buffer.from([0x89, 0x50, 0, 0, 2]));
  git(repo, 'commit', '-q', '-am', 'photo again');
  const second = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  blockList(repo, [V.term2]);
  const r = check(repo, ['--range', 'main..HEAD']);
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    `(path withheld): file path matches block list entry #1 (commit ${first})\n` +
      `(path withheld): file path matches block list entry #1 (commit ${second})\n`,
  );
  assertNoValues(r.all);
});

test('--range=<A..B> checks the range like --range <A..B>', (t) => {
  const repo = makeRepo(t);
  git(repo, 'checkout', '-q', '-b', 'feature');
  write(repo, 'f.txt', `${V.term2}\n`);
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-q', '-m', 'add');
  const head = git(repo, 'rev-parse', '--short', 'HEAD').trim();
  blockList(repo, [V.term2]);
  const r = check(repo, ['--range=main..HEAD']);
  assert.equal(r.code, 1);
  assert.equal(r.out, `f.txt:1: matches block list entry #1 (commit ${head})\n`);
});

test('--range=<value> starting with "-" is a usage error and never reaches git as an option', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  for (const args of [['--range=--output=planted.txt'], ['--range', '--output=planted.txt']]) {
    const r = check(repo, args);
    assert.equal(r.code, 2, `exit code for ${args.join(' ')}`);
    assert.match(r.err, /^usage: /);
    assert.ok(!existsSync(join(repo, 'planted.txt')), `git wrote a file for ${args.join(' ')}`);
  }
});

test('an internal error prints only the error name, never its message, a path or a value', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores file modes');
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  chmodSync(join(repo, '.private-terms'), 0o000);
  t.after(() => existsSync(join(repo, '.private-terms')) && chmodSync(join(repo, '.private-terms'), 0o600));
  stage(repo, 'a.txt', `${V.term1}\n`);
  const r = check(repo);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.match(r.err, /^check-private: internal error \(\w+\)\n$/);
  assertNoValues(r.all);
});

test('an unreadable extension/.env gives a one-line note without its content and the check goes on', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores file modes');
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  write(repo, 'extension/.env', `VITE_PASSWORD=${V.envPassword}\n`);
  chmodSync(join(repo, 'extension/.env'), 0o000);
  t.after(() => existsSync(join(repo, 'extension/.env')) && chmodSync(join(repo, 'extension/.env'), 0o600));
  stage(repo, 'a.txt', `${V.term1}\n`);
  const r = check(repo);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'a.txt:1: matches block list entry #1\n');
  assert.equal(r.err, 'check-private: note: extension/.env can\'t be read; its values are not checked\n');
  assertNoValues(r.all);
});

// ---------------------------------------------------------------------------------------------------------------
// --all mode

test('--all checks every tracked file, not untracked ones, and skips binary files', (t) => {
  const repo = makeRepo(t);
  write(repo, 'tracked.txt', `one\ntwo ${V.term1}\n`);
  writeFileSync(join(repo, 'bin.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(V.term1)]));
  git(repo, 'add', 'tracked.txt', 'bin.dat');
  git(repo, 'commit', '-q', '-m', 'files');
  write(repo, 'untracked.txt', `${V.term1}\n`);
  blockList(repo, [V.term1]);

  const r = check(repo, ['--all']);
  assert.equal(r.code, 1);
  assert.equal(r.out, 'tracked.txt:2: matches block list entry #1\n');
  assertNoValues(r.all);
});

test('--all on a clean tree exits 0 quietly', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  const r = check(repo, ['--all']);
  assert.equal(r.code, 0);
  assert.equal(r.all, '');
});

test('--all never follows a tracked symlink, e.g. to a file outside the repository', (t) => {
  const repo = makeRepo(t);
  const outside = mkdtempSync(join(tmpdir(), 'check-private-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'target.txt'), `${V.term1}\n`);
  symlinkSync(join(outside, 'target.txt'), join(repo, 'link.txt'));
  git(repo, 'add', 'link.txt');
  git(repo, 'commit', '-q', '-m', 'link');
  blockList(repo, [V.term1]);
  const r = check(repo, ['--all']);
  assert.equal(r.code, 0);
  assert.equal(r.all, '');
});

test('an unknown option is a usage error (exit 2)', (t) => {
  const repo = makeRepo(t);
  assert.equal(check(repo, ['--bogus']).code, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// The hook and gitleaks

// PATH without any real gitleaks, plus an optional fake one that logs its arguments.
function hookEnv(t, fakeGitleaks) {
  const bin = mkdtempSync(join(tmpdir(), 'check-private-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const dirs = (process.env.PATH || '').split(delimiter).filter((d) => d && !existsSync(join(d, 'gitleaks')));
  if (fakeGitleaks !== undefined) {
    const log = join(bin, 'args.log');
    writeFileSync(
      join(bin, 'gitleaks'),
      `#!/bin/sh\nif [ "$1" = "git" ] && [ "$2" = "--help" ]; then exit 0; fi\necho "$@" >> "${log}"\nexit ${fakeGitleaks}\n`,
    );
    chmodSync(join(bin, 'gitleaks'), 0o755);
    dirs.unshift(bin);
  }
  return { env: { ...baseEnv, PATH: dirs.join(delimiter) }, log: join(bin, 'args.log') };
}

function runHook(repo, env) {
  const r = spawnSync(HOOK, [], { cwd: repo, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

test('hook: clean commit without gitleaks prints one hint and passes', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', 'clean\n');
  const { env } = hookEnv(t);
  const r = runHook(repo, env);
  assert.equal(r.code, 0);
  const lines = r.all.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /gitleaks/);
});

test('hook: a block-list hit fails the hook without printing the term', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', `${V.term1}\n`);
  const { env } = hookEnv(t);
  const r = runHook(repo, env);
  assert.equal(r.code, 1);
  assert.match(r.all, /a\.txt:1: matches block list entry #1/);
  assertNoValues(r.all);
});

test('hook: runs gitleaks on the staged changes with the repo config and redaction when installed', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  write(repo, '.gitleaks.toml', '[extend]\nuseDefault = true\n');
  stage(repo, 'a.txt', 'clean\n');
  const { env, log } = hookEnv(t, 0);
  const r = runHook(repo, env);
  assert.equal(r.code, 0);
  const args = execFileSync('cat', [log], { encoding: 'utf8' });
  assert.match(args, /^git /);
  assert.match(args, /--staged/);
  assert.match(args, /--redact/);
  assert.match(args, /--config \S*\.gitleaks\.toml/);
});

test('hook: a gitleaks finding fails the hook', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', 'clean\n');
  const { env } = hookEnv(t, 1);
  assert.equal(runHook(repo, env).code, 1);
});

test('hook: without node the commit is refused (fails closed)', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', 'clean\n');
  const bin = mkdtempSync(join(tmpdir(), 'check-private-nonode-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  for (const tool of ['sh', 'git', 'dirname']) {
    const found = execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    symlinkSync(found, join(bin, tool));
  }
  const r = runHook(repo, { ...baseEnv, PATH: bin });
  assert.equal(r.code, 1);
  assert.match(r.err, /node not found/);
});

test('hook: checks only the staged changes, not hits that are already committed', (t) => {
  const repo = makeRepo(t);
  write(repo, 'old.txt', `${V.term1}\n`);
  git(repo, 'add', 'old.txt');
  git(repo, 'commit', '-q', '-m', 'old');
  blockList(repo, [V.term1]);
  stage(repo, 'a.txt', 'clean\n');
  const { env } = hookEnv(t);
  const r = runHook(repo, env);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.all, /matches/);
});

test('hook: git commit is refused through core.hooksPath when a term is staged', (t) => {
  const repo = makeRepo(t);
  blockList(repo, [V.term1]);
  git(repo, 'config', 'core.hooksPath', dirname(HOOK));
  stage(repo, 'a.txt', `${V.term1}\n`);
  const { env } = hookEnv(t);
  const r = spawnSync('git', ['commit', '-q', '-m', 'try'], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assertNoValues(r.stdout + r.stderr);
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD').trim(), '1');
});

// ---------------------------------------------------------------------------------------------------------------
// install-hooks.sh

function installRepo(t) {
  const repo = makeRepo(t);
  mkdirSync(join(repo, '.githooks'));
  writeFileSync(join(repo, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  return repo;
}

function install(repo) {
  const r = spawnSync('sh', [INSTALL], { cwd: repo, env: baseEnv, encoding: 'utf8' });
  return { code: r.status, all: r.stdout + r.stderr };
}

function hooksPath(repo) {
  const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, env: baseEnv, encoding: 'utf8' });
  return r.stdout.trim();
}

test('install-hooks.sh sets core.hooksPath to .githooks and makes the hook executable', (t) => {
  const repo = installRepo(t);
  chmodSync(join(repo, '.githooks', 'pre-commit'), 0o644);
  const r = install(repo);
  assert.equal(r.code, 0);
  assert.equal(hooksPath(repo), '.githooks');
  assert.ok(statSync(join(repo, '.githooks', 'pre-commit')).mode & 0o100);
  assert.equal(install(repo).code, 0, 'a second run is fine');
});

test('install-hooks.sh refuses to replace a different core.hooksPath', (t) => {
  const repo = installRepo(t);
  git(repo, 'config', 'core.hooksPath', 'other-hooks');
  const r = install(repo);
  assert.notEqual(r.code, 0);
  assert.match(r.all, /other-hooks/);
  assert.equal(hooksPath(repo), 'other-hooks');
});

test('the shipped example block list only holds comments and invented example terms', () => {
  const example = readFileSync(join(HERE, '..', '.private-terms.example'), 'utf8');
  const terms = example
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/\s*##\s*allow:.*$/i, ''));
  assert.ok(terms.length > 0, 'the example shows at least one term');
  for (const term of terms) assert.match(term, /ex[ae]mpl/i, 'every term in the example is an invented example');
});
