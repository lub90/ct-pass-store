/** German messages: the type source of `en`. Texts are added with the pages that need them. */
const de = {
    app: {
        name: 'CtPassStore',
    },
    common: {
        save: 'Speichern',
        cancel: 'Abbrechen',
        close: 'Schließen',
        back: 'Zurück',
        loading: 'Lädt …',
    },
    // Page text of „Mein Passwort“ when the settings hold no custom text (spec 4.6).
    password: {
        defaultTitle: 'Mein Zweitpasswort',
        defaultIntro:
            'Ein eigenes Passwort für angebundene Dienste wie das WLAN. Es ist unabhängig von deinem ChurchTools-Passwort.',
    },
};

export default de;
export type Messages = typeof de;
