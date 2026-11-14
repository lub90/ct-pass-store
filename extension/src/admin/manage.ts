/**
 * „Passwörter verwalten“ (spec 4.3) without the page: the search over the users group's members and the address
 * parameter. The members are loaded once per page visit; every search runs over that list, without a request.
 */
import type { PersonOption } from '@/ui';

/** Lower case without accents or umlaut dots: „Müller“ → „muller“, „Ångström“ → „angstrom“. */
function fold(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de');
}

/** The parts of a name a search word may start: split at spaces and hyphens. */
function parts(name: string): string[] {
    return fold(name)
        .split(/[\s-]+/u)
        .filter((p) => p !== '');
}

/**
 * The members for whom every word of the query matches, sorted by name: a word matches a name part that starts with
 * it (case and accents don't matter), and a word of plain digits also matches the ChurchTools id exactly or as a
 * prefix. So „Anna 12“ finds an Anna whose id starts with 12. An empty query finds nobody. Query characters are
 * compared literally.
 */
export function searchUsers(members: readonly PersonOption[], query: string): PersonOption[] {
    const words = fold(query)
        .split(/\s+/u)
        .filter((w) => w !== '');
    if (words.length === 0) return [];
    return members
        .filter((m) => {
            const own = parts(m.name);
            const id = String(m.id);
            return words.every((w) => own.some((p) => p.startsWith(w)) || (/^[0-9]+$/.test(w) && id.startsWith(w)));
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * The person of `/manage/:personId`: a positive safe integer written in plain decimal (no sign, no leading zero, no
 * spaces), or `null`. Nothing else from the address is ever used for a request.
 */
export function parsePersonId(raw: unknown): number | null {
    if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
}
