/** Plain-text helpers for stored text shown inside the app's own sentences (dialog texts, messages). */

/** The embedding, override and isolate controls (U+202A–U+202E, U+2066–U+2069). */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

/**
 * Wraps a text in U+2068 … U+2069 (first-strong isolate): the plain-text form of `<bdi>`, for dialog texts. Bidi
 * controls inside the text become U+FFFD first: a stored U+2069 would otherwise close the isolate early and a U+202E
 * after it reorder the rest of the sentence.
 */
export const isolate = (text: string): string => `⁨${text.replace(BIDI_CONTROLS, '�')}⁩`;
