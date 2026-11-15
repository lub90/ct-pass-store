#!/usr/bin/env node
// Privacy and secrets check for commits (run by .githooks/pre-commit; docs: README.md, "Pre-commit check").
//
//   node scripts/check-private.mjs [--staged]     lines added in the staged diff (default)
//   node scripts/check-private.mjs --range A..B   lines added by every commit in the range
//   node scripts/check-private.mjs --all          every line of every tracked file
//
// Forbidden values come from local files only, and are NEVER printed (not even in error messages):
//   - the gitignored block list .private-terms at the repository root (see .private-terms.example);
//   - the values of local credential files, if present: extension/.env and extension/.env.* (values of 6 or more
//     characters, plus the host name of URL values), the <env value> entries of backend/phpunit.xml, and string fields
//     named like pwd/password/token/secret/username in backend/tests/Contract/fixtures/*.json.
// A hit prints "<file>:<line>: matches <source> entry #<n>" and the exit code is 1. No hit: exit 0, no output.
// Exit code 2: usage or git error.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// Harmless words that coincide with credential values or terms (e.g. the extension key). A match that lies entirely
// inside one of these words is not a hit.
const ALLOWLIST = ['ctpassstore', 'churchtools'];
const MIN_CREDENTIAL_LENGTH = 6;
const CREDENTIAL_FIELD = /pwd|passw|token|secret|user_?name|login/i;
const SEPARATORS = '[\\s._-]';

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message);
}

function parseArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--staged')) return { mode: 'staged' };
  if (argv.length === 1 && argv[0] === '--all') return { mode: 'all' };
  if (argv.length === 2 && argv[0] === '--range' && argv[1] && !argv[1].startsWith('-')) {
    return { mode: 'range', range: argv[1] };
  }
  if (argv.length === 1 && argv[0].startsWith('--range=') && argv[0].length > 8) {
    return { mode: 'range', range: argv[0].slice(8) };
  }
  return usage('usage: check-private.mjs [--staged | --range <A..B> | --all]');
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return usage(`check-private: git ${args[0]} failed`);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------------------------
// Sources

// A block-list term: any run of separators (space, dot, hyphen, underscore) inside it matches any run of separators
// or none, so "ab cd" matches "ab-cd", "AB_CD", "ab.cd" and "abcd".
function termPattern(term) {
  const parts = term.split(new RegExp(`${SEPARATORS}+`)).filter(Boolean);
  return parts.map(escapeRegExp).join(`${SEPARATORS}*`);
}

// Glob on the repo-relative path, anchored at the root: "*" and "?" stay within one path segment, "**" crosses them.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRegExp(c);
  }
  return new RegExp(`^${re}$`);
}

function readBlockList(root, entries) {
  const file = join(root, '.private-terms');
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((raw, i) => {
    let line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let allow = [];
    const exception = /\s*##\s*allow:(.*)$/i.exec(line);
    if (exception) {
      allow = exception[1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map(globToRegExp);
      line = line.slice(0, exception.index).trim();
    }
    const pattern = termPattern(line);
    if (pattern) entries.push({ source: 'block list', n: i + 1, pattern, allow, value: line });
  });
  return true;
}

function addCredential(entries, source, n, value) {
  if (typeof value !== 'string') return;
  const v = value.trim();
  if (v.length < MIN_CREDENTIAL_LENGTH) return;
  entries.push({ source, n, pattern: escapeRegExp(v), allow: [], value: v });
}

function unquote(v) {
  const m = /^(['"])(.*)\1$/.exec(v);
  return m ? m[2] : v.replace(/\s+#.*$/, '');
}

function readEnvFiles(root, entries) {
  const dir = join(root, 'extension');
  if (!existsSync(dir)) return;
  const names = readdirSync(dir)
    .filter((f) => f === '.env' || f.startsWith('.env.'))
    .sort();
  for (const name of names) {
    const rel = `extension/${name}`;
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((raw, i) => {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(raw);
      if (!m) return;
      const value = unquote(m[2].trim());
      addCredential(entries, `${rel} ${m[1]}`, i + 1, value);
      try {
        const host = new URL(value).hostname;
        if (host && host !== value) addCredential(entries, `${rel} ${m[1]} (host)`, i + 1, host);
      } catch {
        // not a URL
      }
    });
  }
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function readPhpunit(root, entries) {
  const file = join(root, 'backend', 'phpunit.xml');
  if (!existsSync(file)) return;
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const tag of line.matchAll(/<env\b([^>]*)>/g)) {
        const name = /\bname\s*=\s*"([^"]*)"/.exec(tag[1]) || /\bname\s*=\s*'([^']*)'/.exec(tag[1]);
        const value = /\bvalue\s*=\s*"([^"]*)"/.exec(tag[1]) || /\bvalue\s*=\s*'([^']*)'/.exec(tag[1]);
        if (value) addCredential(entries, `backend/phpunit.xml ${name ? name[1] : '(unnamed)'}`, i + 1, decodeXml(value[1]));
      }
    });
}

function readFixtures(root, entries, notes) {
  const dir = join(root, 'backend', 'tests', 'Contract', 'fixtures');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const rel = `backend/tests/Contract/fixtures/${name}`;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      // The parser's message quotes the file's content, so it is never shown.
      notes.push(`check-private: note: ${rel} is not valid JSON; its values are not checked`);
      continue;
    }
    let n = 0;
    const walk = (v, path, key) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, k);
      } else if (typeof v === 'string' && key !== undefined && CREDENTIAL_FIELD.test(key)) {
        n++;
        addCredential(entries, `${rel} ${path}`, n, v);
      }
    };
    walk(data, '', undefined);
  }
}

// The main checkout's root when running in a linked worktree (its local files live there), else null.
function mainWorktreeRoot(root) {
  const common = resolve(root, git(['rev-parse', '--git-common-dir'], root).trim());
  const main = dirname(common);
  return common.endsWith('.git') && main !== root ? main : null;
}

function loadEntries(root) {
  const entries = [];
  const notes = [];
  const roots = [root, mainWorktreeRoot(root)].filter(Boolean);
  const termsRoot = roots.find((r) => existsSync(join(r, '.private-terms')));
  if (termsRoot) readBlockList(termsRoot, entries);
  else notes.push('check-private: hint: no .private-terms block list found; copy .private-terms.example to fill one');
  const credRoot = roots.find((r) => existsSync(join(r, 'extension', '.env')) || existsSync(join(r, 'backend', 'phpunit.xml'))) || root;
  readEnvFiles(credRoot, entries);
  readPhpunit(credRoot, entries);
  readFixtures(credRoot, entries, notes);

  // The first source of a value wins; a value that is itself an allowlisted word never blocks.
  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = e.pattern.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    e.regex = new RegExp(e.pattern, 'giu');
    delete e.value;
    unique.push(e);
  }
  return { entries: unique, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// Matching

const allowRegex = new RegExp(ALLOWLIST.map(escapeRegExp).join('|'), 'giu');

function allowedSpans(text) {
  const spans = [];
  for (const m of text.matchAll(allowRegex)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function hits(entry, text, spans) {
  entry.regex.lastIndex = 0;
  for (let i = 0; i <= text.length; ) {
    entry.regex.lastIndex = i;
    const m = entry.regex.exec(text);
    if (!m) return false;
    const end = m.index + m[0].length;
    if (!spans.some(([a, b]) => a <= m.index && end <= b)) return true;
    i = m.index + 1;
  }
  return false;
}

function checker(entries, report) {
  const pathHit = new Map();
  return {
    line(file, lineNo, text, suffix) {
      const spans = allowedSpans(text);
      for (const e of entries) {
        if (e.allow.some((g) => g.test(file))) continue;
        if (hits(e, text, spans)) {
          report(`${file}:${lineNo}: matches ${e.source} entry #${e.n}${suffix}`);
        }
      }
    },
    path(file, suffix) {
      const spans = allowedSpans(file);
      for (const e of entries) {
        if (e.allow.some((g) => g.test(file))) continue;
        const key = `${e.source}#${e.n}${suffix}`;
        if (hits(e, file, spans) && !pathHit.has(`${file}\0${key}`)) {
          pathHit.set(`${file}\0${key}`, true);
          report(`(path withheld): file path matches ${e.source} entry #${e.n}${suffix}`);
        }
      }
    },
  };
}

// Git quotes unusual paths ("a\tb"); undo the C-style quoting.
function unquotePath(p) {
  if (!p.startsWith('"')) return p;
  const bytes = [];
  const s = p.slice(1, -1);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') {
      bytes.push(...Buffer.from(s[i]));
      continue;
    }
    const c = s[++i];
    if (/[0-7]/.test(c)) {
      bytes.push(parseInt(s.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push({ n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 }[c] ?? c.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

const COMMIT_MARK = '\u0001commit ';

// Walks a unified diff (-U0) and checks every added line; "commit" markers come from `git log --format`.
function checkDiff(diff, check) {
  let file = null;
  let lineNo = 0;
  let inHunk = false;
  let suffix = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith(COMMIT_MARK)) {
      suffix = ` (commit ${line.slice(COMMIT_MARK.length).trim()})`;
      inHunk = false;
      file = null;
    } else if (line.startsWith('diff --git ')) {
      inHunk = false;
      file = null;
    } else if (!inHunk && line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/\t$/, '');
      file = p === '/dev/null' ? null : unquotePath(p).replace(/^b\//, '');
      if (file) check.path(file, suffix);
    } else if (line.startsWith('@@ ')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      lineNo = m ? Number(m[1]) : 0;
      inHunk = true;
    } else if (inHunk && file && line.startsWith('+')) {
      check.line(file, lineNo, line.slice(1), suffix);
      lineNo++;
    } else if (inHunk && line.startsWith(' ')) {
      lineNo++;
    }
  }
}

const DIFF_OPTS = ['-c', 'core.quotePath=true', '-c', 'diff.noprefix=false'];
const DIFF_FLAGS = ['-U0', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/'];

function checkAll(root, check) {
  const files = git(['ls-files', '-z'], root).split('\0').filter(Boolean);
  for (const file of files) {
    check.path(file, '');
    const full = join(root, file);
    let buf;
    try {
      if (!lstatSync(full).isFile()) continue;
      buf = readFileSync(full);
    } catch {
      continue;
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    buf
      .toString('utf8')
      .split(/\r?\n/)
      .forEach((text, i) => check.line(file, i + 1, text, ''));
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const { entries, notes } = loadEntries(root);
  for (const note of notes) process.stderr.write(`${note}\n`);
  const out = [];
  const check = checker(entries, (msg) => out.push(msg));

  if (opts.mode === 'range') {
    // Validate the range first: a bad revision must not look like "no hits".
    git(['rev-list', '--quiet', opts.range, '--'], root);
  }
  if (entries.length > 0) {
    if (opts.mode === 'staged') {
      checkDiff(git([...DIFF_OPTS, 'diff', '--cached', ...DIFF_FLAGS], root), check);
    } else if (opts.mode === 'range') {
      const log = git(
        [...DIFF_OPTS, 'log', '--reverse', '-p', ...DIFF_FLAGS, `--format=${COMMIT_MARK}%h`, opts.range, '--'],
        root,
      );
      checkDiff(log, check);
    } else {
      checkAll(root, check);
    }
  }

  if (out.length > 0) {
    process.stdout.write(out.join('\n') + '\n');
    return 1;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  // Never print an error message as such: it may quote a value.
  process.stderr.write(err instanceof UsageError ? `${err.message}\n` : `check-private: internal error (${err?.name})\n`);
  process.exitCode = 2;
}
