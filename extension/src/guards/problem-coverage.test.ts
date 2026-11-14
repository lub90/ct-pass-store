/** Every problem type the backend documents has a mapping in `backend/problems.ts` (spec 8.2, 13.4). */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackendProblem, PROBLEM_KEYS, problemMessageKey } from '@/backend/problems';

const DOC = path.resolve('..', 'backend', 'docs', 'problems.md');

/** The slugs of the `## slug` headings of the problem page. */
export function documentedSlugs(markdown: string): string[] {
    return [...markdown.matchAll(/^##\s+([a-z0-9-]+)\s*$/gm)].map((m) => m[1]!);
}

describe('problem coverage', () => {
    it('finds headings (self-check)', () => {
        expect(documentedSlugs('# T\n\n## a-b\ntext\n## c1 \n### nested\n## Not A Slug\n')).toEqual(['a-b', 'c1']);
    });

    const slugs = documentedSlugs(fs.readFileSync(DOC, 'utf8'));

    it('reads the documented problem types', () => {
        expect(slugs.length).toBeGreaterThanOrEqual(27);
        expect(slugs).toContain('person-not-found');
        expect(slugs).toContain('entry-not-found');
    });

    for (const slug of slugs) {
        it(`${slug} has a mapping`, () => {
            expect(Object.hasOwn(PROBLEM_KEYS, slug), `no mapping for ${slug}`).toBe(true);
            expect(problemMessageKey(new BackendProblem(slug, 400))).toBe(PROBLEM_KEYS[slug]);
        });
    }
});
