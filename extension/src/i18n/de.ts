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
        primaryRequired: 'Bitte gib dein ChurchTools-Passwort ein.',
        customNotAllowed: 'Eigene Passwörter sind gerade nicht erlaubt.',
        invalidCustom: 'Das Passwort erfüllt die Regeln nicht.',
        notReady: 'Hier gibt es gerade nichts zu senden.',
    },
    auth: {
        finishing: 'Anmeldung wird abgeschlossen …',
    },
    problems: {
        entryNotFound: 'Noch kein Passwort',
        primaryPasswordRequired: 'Bitte gib dein ChurchTools-Passwort ein.',
        invalidPrimaryPassword: 'Das ChurchTools-Passwort stimmt nicht.',
        passwordInvalid: 'Das Passwort erfüllt die Regeln nicht.',
        customPasswordNotAllowed: 'Eigene Passwörter sind gerade nicht erlaubt.',
        rateLimited: 'Zu viele Versuche. Versuch es in {n} Minuten noch einmal.',
        session: 'Deine Anmeldung ist abgelaufen. Lade die Seite neu.',
        noServiceAccess: 'Du hast keinen Zugriff auf diese Erweiterung.',
        forbidden: 'Dafür hast du keine Berechtigung.',
        personNotFound: 'Diese Person gibt es in ChurchTools nicht mehr.',
        loginFailed: 'Die Anmeldung hat nicht geklappt. Lade die Seite neu.',
        upstreamUnavailable: 'ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.',
        notSetUp: 'Der Dienst ist noch nicht richtig eingerichtet.',
        generic: 'Etwas ist schiefgelaufen ({status}).',
        unreachable: 'Der Dienst ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
        unexpected: 'Der Dienst hat unerwartet geantwortet ({status}).',
    },
};

export default de;
export type Messages = typeof de;
