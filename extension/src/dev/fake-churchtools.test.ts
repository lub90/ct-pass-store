/** Fake-only controls (not part of the contract). */
import { describe, expect, it } from 'vitest';
import { createFakeChurchTools } from './fake-churchtools';

const NONE = {
    view: true,
    'create custom category': false,
    'view custom category': [],
    'edit custom category': [],
    'delete custom category': [],
    'view custom data': [],
    'create custom data': [1],
    'edit custom data': [],
    'delete custom data': [],
};

describe('fake ChurchTools dumpValues', () => {
    it('returns every value, also of categories the person cannot read, as copies', async () => {
        const fake = createFakeChurchTools({
            moduleKey: 'k',
            moduleId: 7,
            currentPersonId: 1,
            persons: [{ id: 1, firstName: 'A', lastName: 'B' }],
            groups: [],
            categories: [{ id: 1, name: 'one', shorty: 'one' }, { id: 2, name: 'two', shorty: 'two' }],
            values: [{ id: 5, dataCategoryId: 2, value: '"x"' }],
            permissions: NONE,
        });
        await fake.createValue(7, 1, '"y"');
        const dump = fake.dumpValues();
        expect(dump).toEqual([
            { id: 5, dataCategoryId: 2, value: '"x"' },
            { id: 6, dataCategoryId: 1, value: '"y"' },
        ]);
        dump[0]!.value = 'changed';
        expect(fake.dumpValues()[0]!.value).toBe('"x"');
    });
});
