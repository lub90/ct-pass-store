import { describe, expect, it } from 'vitest';
import de from './de';
import en from './en';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
    return Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
}

describe('message files', () => {
    it('have the same keys in de and en', () => {
        expect(keys(en).sort()).toEqual(keys(de).sort());
    });
    it('have no empty messages', () => {
        for (const messages of [de, en]) {
            for (const key of keys(messages)) {
                const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages);
                expect(value, key).not.toBe('');
            }
        }
    });
});
