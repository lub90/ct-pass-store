import de from './de';
import en from './en';
import type { Language } from './language';

export type PageTextsInput = Partial<Record<Language, { title?: string; intro?: string }>>;

const DEFAULTS: Record<Language, { title: string; intro: string }> = {
    de: { title: de.password.defaultTitle, intro: de.password.defaultIntro },
    en: { title: en.password.defaultTitle, intro: en.password.defaultIntro },
};

/** Title and explanation of „Mein Passwort“: the custom text if not blank, else the default (spec 10.3). */
export function pageTexts(texts: PageTextsInput | undefined, language: Language): { title: string; intro: string } {
    const custom = texts?.[language];
    return {
        title: custom?.title?.trim() || DEFAULTS[language].title,
        intro: custom?.intro?.trim() || DEFAULTS[language].intro,
    };
}
