import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AccessSchema, SettingsSchema } from '@/model/schemas';
import { DEMO_SEED, DEMO_STRINGS } from './demo-data';

/** Every text of the seed a reader could recognise, which `check-dist` must therefore find in a build. */
function seedTexts(): string[] {
    return [
        ...DEMO_SEED.persons.map((p) => p.lastName),
        ...DEMO_SEED.groups.map((g) => g.name),
        ...DEMO_SEED.access.machineClients.flatMap((c) => [c.id, c.name, ...c.publicKeys]),
        DEMO_SEED.settings.backendUrl,
        DEMO_SEED.settings.oauthClientId,
        ...Object.values(DEMO_SEED.entries),
    ];
}

describe('demo data', () => {
    it('carries the demo marker', () => {
        expect(DEMO_SEED.marker).toBe('__DEMO__');
    });

    it('lists every recognisable seed text in DEMO_STRINGS', () => {
        for (const text of seedTexts()) {
            expect(DEMO_STRINGS.some((s) => text.includes(s)), text).toBe(true);
        }
    });

    it('has DEMO_STRINGS distinctive enough not to match ordinary app text', () => {
        for (const s of DEMO_STRINGS) expect(s.length, s).toBeGreaterThanOrEqual(7);
    });

    it('uses the reserved .invalid domain for the backend', () => {
        expect(new URL(DEMO_SEED.settings.backendUrl).hostname).toMatch(/\.invalid$/);
    });

    it('stores valid settings and access values', () => {
        expect(v.safeParse(SettingsSchema, DEMO_SEED.settings).success).toBe(true);
        expect(v.safeParse(AccessSchema, DEMO_SEED.access).success).toBe(true);
    });
});
