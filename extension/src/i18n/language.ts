export const SUPPORTED = ['de', 'en'] as const;
export type Language = (typeof SUPPORTED)[number];

const FALLBACK: Language = 'en';

/** First preferred language whose primary subtag is supported (`de-AT` → `de`), else English. */
export function pickLanguage(preferred: readonly string[]): Language {
    for (const tag of preferred) {
        const primary = tag.split('-')[0]?.toLowerCase();
        const match = SUPPORTED.find((l) => l === primary);
        if (match) return match;
    }
    return FALLBACK;
}
