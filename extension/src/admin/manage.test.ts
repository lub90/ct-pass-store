import { describe, expect, it } from 'vitest';
import type { PersonOption } from '@/ui';
import { parsePersonId, searchUsers } from './manage';

const MEMBERS: PersonOption[] = [
    { id: 1, name: 'Anna Admin' },
    { id: 2, name: 'Jürgen Müller' },
    { id: 3, name: 'Zoë Ångström-Weiß' },
    { id: 4, name: 'Bernd Mulde' },
    { id: 5, name: 'Mia Schmidt' },
];

const names = (found: PersonOption[]) => found.map((p) => p.name);

describe('searchUsers (spec 4.3)', () => {
    it('finds „Müller“ for „mul“ and „Mül“, case- and accent-insensitive', () => {
        expect(names(searchUsers(MEMBERS, 'mul'))).toContain('Jürgen Müller');
        expect(names(searchUsers(MEMBERS, 'Mül'))).toContain('Jürgen Müller');
        expect(names(searchUsers(MEMBERS, 'MÜLLER'))).toEqual(['Jürgen Müller']);
        expect(names(searchUsers(MEMBERS, 'jurg'))).toEqual(['Jürgen Müller']);
    });

    it('matches the start of any name part, also after a hyphen', () => {
        expect(names(searchUsers(MEMBERS, 'angst'))).toEqual(['Zoë Ångström-Weiß']);
        expect(names(searchUsers(MEMBERS, 'zoe'))).toEqual(['Zoë Ångström-Weiß']);
        expect(names(searchUsers(MEMBERS, 'weiß'))).toEqual(['Zoë Ångström-Weiß']);
        // Not in the middle of a part.
        expect(searchUsers(MEMBERS, 'ller')).toEqual([]);
    });

    it('needs every word of the query, in any order', () => {
        expect(names(searchUsers(MEMBERS, 'müller jü'))).toEqual(['Jürgen Müller']);
        expect(names(searchUsers(MEMBERS, '  mu  ber '))).toEqual(['Bernd Mulde']);
        expect(searchUsers(MEMBERS, 'müller bernd')).toEqual([]);
    });

    it('sorts the hits by name and finds nothing for an empty query', () => {
        expect(names(searchUsers(MEMBERS, 'mu'))).toEqual(['Bernd Mulde', 'Jürgen Müller']);
        expect(searchUsers(MEMBERS, '   ')).toEqual([]);
    });

    it('takes query characters literally (no pattern syntax)', () => {
        const odd: PersonOption[] = [{ id: 9, name: 'A.{x}|@b (c)' }];
        expect(searchUsers(odd, '.*')).toEqual([]);
        expect(names(searchUsers(odd, 'a.{x}'))).toEqual(['A.{x}|@b (c)']);
        expect(names(searchUsers(odd, '(c'))).toEqual(['A.{x}|@b (c)']);
    });

    it('does not change the list it is given', () => {
        const members = [...MEMBERS];
        searchUsers(members, 'mu');
        expect(members).toEqual(MEMBERS);
    });
});

describe('parsePersonId (the /manage/:personId parameter)', () => {
    it.each([
        ['5', 5],
        ['123456', 123456],
    ])('accepts %s', (raw, id) => {
        expect(parsePersonId(raw)).toBe(id);
    });

    it.each([undefined, '', '0', '-1', '05', '+5', ' 5', '5 ', '5.0', '1e3', '0x10', 'abc', '9007199254740993', ['5'], 5])(
        'rejects %j',
        (raw) => {
            expect(parsePersonId(raw)).toBeNull();
        },
    );
});

describe('searchUsers by ChurchTools id', () => {
    const many: PersonOption[] = [
        { id: 12, name: 'Anna Admin' },
        { id: 123, name: 'Jürgen Müller' },
        { id: 1234, name: 'Bernd Mulde' },
        { id: 7, name: 'Mia 12er' },
    ];

    it('a number finds the id exactly or as a prefix', () => {
        expect(searchUsers(many, '1234').map((p) => p.id)).toEqual([1234]);
        expect(searchUsers(many, '123').map((p) => p.id).sort()).toEqual([123, 1234]);
        expect(searchUsers(many, '7').map((p) => p.id)).toEqual([7]);
        expect(searchUsers(many, '23')).toEqual([]);
    });

    it('a number also still matches a name part (names are unchanged)', () => {
        expect(searchUsers(many, '12').map((p) => p.id).sort((a, b) => a - b)).toEqual([7, 12, 123, 1234]);
    });

    it('mixed queries: every word must match, a name part or (for digits) the id', () => {
        expect(searchUsers(many, 'jürgen 12').map((p) => p.id)).toEqual([123]);
        expect(searchUsers(many, 'jürgen 7')).toEqual([]);
        expect(searchUsers(many, 'anna 12').map((p) => p.id)).toEqual([12]);
    });

    it('only plain digits count as an id', () => {
        expect(searchUsers(many, '#12')).toEqual([]);
        expect(searchUsers(many, '-12')).toEqual([]);
    });
});
