import { createMemoryHistory } from 'vue-router';
import { describe, expect, it } from 'vitest';
import type { RouteRequirement } from './app/app-state';
import { createAppRouter } from './router';

// Spec 4.1, column „Wer“: who a route is for. Pages check nothing themselves yet, so this table is the only guard.
const WHO: [string, RouteRequirement | undefined][] = [
    ['/', undefined],
    ['/about', undefined],
    ['/manage', 'admin'],
    ['/manage/5', 'admin'],
    ['/settings', 'editor'],
    ['/settings/rules', 'editor'],
    ['/settings/texts', 'editor'],
    ['/settings/access', 'editor'],
    ['/settings/access/clients/new', 'editor'],
    ['/settings/access/clients/x', 'editor'],
    ['/settings/backend', 'editor'],
    ['/settings/backup', 'admin'],
    ['/settings/setup', 'admin'],
    ['/auth/callback', undefined],
    ['/no/such/page', undefined],
];

describe('routes (spec 4.1)', () => {
    it.each(WHO)('%s requires %s', (path, requires) => {
        const router = createAppRouter(createMemoryHistory());
        expect(router.resolve(path).meta.requires).toBe(requires);
    });
});
