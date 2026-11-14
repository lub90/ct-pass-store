/**
 * The rules of „Zugriff“ and the client form (spec 4.7), without the pages. Keys and clients are checked exactly like
 * the backend reads them (backend spec 3.2, `model/machine-clients.ts`, pinned by `shared/access-client-cases.json`),
 * so the backend never disables a client the extension saved. Public keys are never logged.
 */
import { decodeKey, readMachineClients, type ClientReason } from '../model/machine-clients';

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
