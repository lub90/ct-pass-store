/**
 * The rules of „Zugriff“ and the client form (spec 4.7), without the pages. Keys and clients are checked exactly like
 * the backend reads them (backend spec 3.2, `model/machine-clients.ts`, pinned by `shared/access-client-cases.json`),
 * so the backend never disables a client the extension saved. Public keys are never logged.
 */
import { decodeKey, PERMISSION_READ_ENTRIES, phpTrim, readMachineClients, type ClientReason } from '../model/machine-clients';
import type { AccessV2, MachineClient } from '../model/schemas';

/** An entry the backend would disable, with its reasons in the backend's order. */
export interface ClientIssue {
    index: number;
    /** The raw id, if it is a string. */
    id?: string;
    reasons: ClientReason[];
}

const MAX_ID = 40;
const MIN_ID = 3;
const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', ẞ: 'Ss' };

/**
 * An id proposed from a name: lowercase ASCII letters and digits, umlauts written out (ü → ue), other accents dropped
 * (é → e), every other run of characters one `-`, no `-` at either end, at most 40 characters. Shorter than 3: `''`
 * (nothing to propose).
 */
export function slugFromName(name: string): string {
    const slug = name
        .replace(/[äöüÄÖÜßẞ]/g, (c) => UMLAUTS[c] ?? '')
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_ID)
        .replace(/-+$/, '');
    return slug.length >= MIN_ID ? slug : '';
}

/**
 * The 32 bytes of an Ed25519 public key pasted as base64 or base64url (backend spec 3.2: canonical, after trimming
 * what PHP's `trim()` trims), else `null`.
 */
export function parsePublicKey(text: string): Uint8Array | null {
    const raw = decodeKey(text);
    if (raw === null) return null;
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Every entry the backend would disable if this list were stored: duplicate ids (all of them), a key shared between
 * clients (all of them), no keys, and the other reasons of backend spec 3.2. Empty: the backend enables every entry.
 */
export function validateClients(clients: readonly unknown[]): ClientIssue[] {
    return readMachineClients([...clients])
        .entries.filter((e) => e.reasons.length > 0)
        .map((e) => (e.id === undefined ? { index: e.index, reasons: e.reasons } : { index: e.index, id: e.id, reasons: e.reasons }));
}

/**
 * Today as `YYYY-MM-DD` in the admin's own time zone (`createdAt` of a new client): the date they see on their
 * calendar. The backend only checks that it is a real date, so a day off near midnight UTC does no harm.
 */
export function todayIso(now: Date): string {
    const pad = (n: number, width: number) => String(n).padStart(width, '0');
    return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/**
 * The group's page in ChurchTools, from the ChurchTools base URL and the group id only (nothing stored is put into the
 * link). `null` if the base isn't a plain http(s) URL or the id no positive safe integer.
 */
export function groupPageUrl(base: string, groupId: number): string | null {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return null;
    if (/[?#]/.test(base)) return null;
    let url: URL;
    try {
        url = new URL(base);
    } catch {
        return null;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/groups/${groupId}/dashboard`;
}

const K = Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4), synchronous so the page can show fingerprints without waiting for WebCrypto. */
export function sha256(data: Uint8Array): Uint8Array {
    const length = Math.ceil((data.length + 9) / 64) * 64;
    const block = new Uint8Array(length);
    block.set(data);
    block[data.length] = 0x80;
    const view = new DataView(block.buffer);
    view.setUint32(length - 8, Math.floor((data.length * 8) / 2 ** 32));
    view.setUint32(length - 4, (data.length * 8) >>> 0);
    const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15]!;
            const b = w[i - 2]!;
            const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
            const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
            w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
        }
        [a, b, c, d, e, f, g, hh].forEach((x, i) => (h[i] = (h[i]! + x) >>> 0));
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    h.forEach((x, i) => outView.setUint32(i * 4, x));
    return out;
}

/**
 * A short fingerprint of a public key: the first 8 characters of base64url(SHA-256(the 32 key bytes)). The same
 * whatever encoding was pasted, so an admin can compare it with the service's own key (spec 4.7 says how).
 */
export function keyFingerprint(bytes: Uint8Array): string {
    const b64 = btoa(String.fromCharCode(...sha256(bytes)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
}

/** What the page shows of a stored entry, whatever its shape. Unchecked data: shown as plain text only. */
export interface EntryInfo {
    name?: string;
    canRead: boolean;
    createdAt?: string;
    /** A positive safe integer (a ChurchTools person ID); anything else is ignored. */
    createdBy?: number;
    /** One per stored key: its fingerprint, or `null` if it isn't a valid key. */
    fingerprints: (string | null)[];
}

export function describeEntry(raw: unknown): EntryInfo {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { canRead: false, fingerprints: [] };
    const e = raw as Record<string, unknown>;
    const keys = Array.isArray(e.publicKeys) ? (e.publicKeys as unknown[]) : [];
    const by = e.createdBy;
    return {
        ...(typeof e.name === 'string' ? { name: e.name } : {}),
        canRead: Array.isArray(e.permissions) && e.permissions.includes(PERMISSION_READ_ENTRIES),
        ...(typeof e.createdAt === 'string' ? { createdAt: e.createdAt } : {}),
        ...(typeof by === 'number' && Number.isSafeInteger(by) && by > 0 ? { createdBy: by } : {}),
        fingerprints: keys.map((k) => {
            const bytes = typeof k === 'string' ? parsePublicKey(k) : null;
            return bytes ? keyFingerprint(bytes) : null;
        }),
    };
}

/**
 * Indices (in `list`) of the entries the backend disables now but would enable once the entries at `drop` are gone:
 * removing one of two entries with the same id, or one of two clients sharing a key, turns the other one on.
 */
export function newlyEnabled(list: readonly unknown[], drop: readonly number[]): number[] {
    const before = new Set(readMachineClients([...list]).entries.filter((e) => e.reasons.length === 0).map((e) => e.index));
    const remaining = list.map((_, i) => i).filter((i) => !drop.includes(i));
    return readMachineClients(remaining.map((i) => list[i]))
        .entries.filter((e) => e.reasons.length === 0)
        .map((e) => remaining[e.index]!)
        .filter((i) => !before.has(i));
}

/** Wraps a text in U+2068 … U+2069 (first-strong isolate): the plain-text form of `<bdi>`, for dialog texts. */
export const isolate = (text: string): string => `⁨${text}⁩`;

/**
 * The empty client the form starts from: no permission until it is turned on, `createdAt` today (local),
 * `createdBy` the logged-in person (left out, never `null`, without one).
 */
export function draftClient(personId: number | null, now: Date): MachineClient {
    return { id: '', name: '', publicKeys: [''], permissions: [], createdAt: todayIso(now), ...(personId === null ? {} : { createdBy: personId }) };
}

/** The value as stored: name and keys of the client at `index` trimmed like the backend trims them; nothing else. */
export function finalizeClient(value: AccessV2, index: number): AccessV2 {
    return {
        ...value,
        machineClients: value.machineClients.map((c, i) => (i === index ? { ...c, name: phpTrim(c.name), publicKeys: c.publicKeys.map(phpTrim) } : c)),
    };
}
