import { createI18n } from 'vue-i18n';
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

