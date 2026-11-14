import { createI18n, type Composer } from 'vue-i18n';
import de from './de';
import en from './en';
import type { Language } from './language';

export function createAppI18n(language: Language) {
    return createI18n<[typeof de], Language, false>({
        legacy: false,
        locale: language,
        fallbackLocale: 'en',
        messages: { de, en },
    });
}

export { SUPPORTED, pickLanguage, type Language } from './language';
export { pageTexts, type PageTextsInput } from './custom-texts';

/** Messages with a singular form (`… in einer Minute … | … in {n} Minuten …`), chosen by `{n}`. */
const PLURAL_KEYS = new Set(['problems.rateLimited', 'state.ctRateLimited']);

/** `t(key, params)`, with the plural form picked by `params.n` for the messages that have one. */
export function translate(t: Composer['t'], key: string, params: Record<string, unknown> = {}): string {
    return PLURAL_KEYS.has(key) && typeof params.n === 'number' ? t(key, params, params.n) : t(key, params);
}
