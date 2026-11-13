/**
 * Texts live in the message files: a template of the app (outside `ui/`, whose components get their texts as props)
 * has no bare text with letters outside `{{ }}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeTypes, parse, type ElementNode, type TemplateChildNode } from '@vue/compiler-dom';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');
const UI = path.join(SRC, 'ui');

function vueFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (full === UI) return [];
        if (entry.isDirectory()) return vueFiles(full);
        return entry.name.endsWith('.vue') ? [full] : [];
    });
}

/** Texts with letters in a template: static text nodes and static attributes that show to people. */
export function bareTexts(template: string): string[] {
    const found: string[] = [];
    const visit = (nodes: TemplateChildNode[]): void => {
        for (const node of nodes) {
            if (node.type === NodeTypes.TEXT && /\p{L}/u.test(node.content)) found.push(node.content.trim());
            if (node.type === NodeTypes.ELEMENT) {
                for (const p of (node as ElementNode).props) {
                    if (
                        p.type === NodeTypes.ATTRIBUTE &&
                        ['title', 'placeholder', 'alt', 'aria-label'].includes(p.name) &&
                        p.value &&
                        /\p{L}/u.test(p.value.content)
                    ) {
                        found.push(`${p.name}="${p.value.content}"`);
                    }
                }
            }
            if ('children' in node && Array.isArray(node.children)) visit(node.children as TemplateChildNode[]);
        }
    };
    visit(parse(template).children);
    return found;
}

describe('no bare text in templates', () => {
    it('finds bare text (self-check)', () => {
        expect(bareTexts('<p>Hallo {{ x }}</p>')).toEqual(['Hallo']);
        expect(bareTexts('<p>{{ $t("a") }}</p><b :title="x" />')).toEqual([]);
        expect(bareTexts('<input placeholder="Name">')).toEqual(['placeholder="Name"']);
    });

    for (const file of vueFiles(SRC)) {
        it(path.relative(SRC, file), () => {
            const source = fs.readFileSync(file, 'utf8');
            const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? '';
            expect(bareTexts(template)).toEqual([]);
        });
    }
});
