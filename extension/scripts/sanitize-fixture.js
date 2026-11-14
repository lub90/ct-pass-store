#!/usr/bin/env node
// Strips a recorded contract response of everything that must not be kept (spec 13.2): secrets, names and contact
// data, the instance host, tokens and hashes. Recorded responses go to tests/contract/fixtures/ only through this.
//
// CLI: node scripts/sanitize-fixture.js <in.json> <out.json>   (the host comes from CT_API_URL; the output gets mode 600)
import fs from 'node:fs';
import { URL, pathToFileURL } from 'node:url';

/** Keys whose value is a secret, whatever it looks like (as the backend's Redact helper, plus a few more). */
const SECRET_KEY = /token|secret|password|pwd|code|csrf|cookie|authorization|session|jwt|key/i;
/** Keys holding names or contact data of a person or group. */
const PERSONAL_KEY = /^(first|last|nick|user|birth|display)?name$|^title$|^initials$|^cmsuserid$|^login|^birth|^e-?mail|^(mobile|phone|fax|street|city|zip|address)/i;

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
/**
 * Long runs of hex or base64(url) characters: login tokens, hashes, fingerprints, ciphertexts. A run with `/` is only
 * opaque if it also has `+`, `=` or several digits, so URL paths (problem types, API paths) stay readable.
 */
const LONG_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
const opaque = (run) => !run.includes('/') || /[+=]/.test(run) || (run.match(/[0-9]/g) ?? []).length >= 6;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sanitizeString(s, hostPattern) {
    const trimmed = s.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
        try {
            return JSON.stringify(sanitizeValue(JSON.parse(trimmed), hostPattern));
        } catch {
            // not JSON: treated as text below
        }
    }
    return s.replace(hostPattern, 'ct.example').replace(JWT, '<jwt>').replace(EMAIL, '<email>').replace(LONG_RUN, (run) => (opaque(run) ? '<hash>' : run));
}

function sanitizeValue(value, hostPattern) {
    if (typeof value === 'string') return sanitizeString(value, hostPattern);
    if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, hostPattern));
    if (value === null || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) out[key] = '<redacted>';
        else if (PERSONAL_KEY.test(key) && item !== null && typeof item !== 'boolean') out[key] = '<name>';
        else out[key] = sanitizeValue(item, hostPattern);
    }
    return out;
}

/** A sanitized deep copy of `value`. `host`: the instance host (required, so it can't slip through by mistake). */
export function sanitizeFixture(value, { host } = {}) {
    if (typeof host !== 'string' || host === '') throw new Error('sanitizeFixture needs the instance host');
    return sanitizeValue(value, new RegExp(escapeRegExp(host), 'gi'));
}

function main(argv) {
    const [input, output] = argv;
    const apiUrl = process.env.CT_API_URL;
    if (!input || !output) throw new Error('usage: sanitize-fixture.js <in.json> <out.json>');
    if (!apiUrl) throw new Error('CT_API_URL is not set; it names the host to remove');
    const sanitized = sanitizeFixture(JSON.parse(fs.readFileSync(input, 'utf8')), { host: new URL(apiUrl).host });
    fs.writeFileSync(output, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(output, 0o600);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(`sanitize-fixture: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
