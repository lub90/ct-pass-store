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
    nav: {
        label: 'Bereiche',
        myPassword: 'Mein Passwort',
        manage: 'Passwörter verwalten',
        settings: 'Einstellungen',
        about: 'Über',
    },
    pages: {
        rules: 'Passwortregeln',
        texts: 'Texte',
        access: 'Zugriff',
        client: 'Maschinen-Client',
        backend: 'Backend & Status',
        backup: 'Sicherung',
        setup: 'Einrichtung',
        comingSoon: 'Diese Seite folgt mit einem späteren Schritt.',
    },
    // App states (spec 3.2, 3.3, versioning.md 3).
    state: {
        loading: 'Lade …',
        noAccess: 'Du hast keinen Zugriff auf diese Erweiterung. Wende dich an die Verantwortlichen in deiner Gemeinde.',
        waiting: 'Die Erweiterung wird gerade eingerichtet. Wende dich bei Fragen an die Verantwortlichen in deiner Gemeinde.',
        setupNote: 'Der neue Einrichtungsassistent kommt mit der nächsten Version der Erweiterung.',
        updateNeeded: 'Bitte aktualisiere die Erweiterung.',
        updateVersions: 'Gespeicherte Daten: Version {stored}. Diese Erweiterung ({app}) kennt Version {supported}.',
        unavailable: 'Der Dienst ist gerade nicht erreichbar. Versuch es später noch einmal.',
        ctUnavailable: 'ChurchTools antwortet gerade nicht. Versuch es gleich noch einmal.',
        ctRateLimited: 'ChurchTools bremst gerade. Versuch es in {n} Minuten noch einmal.',
        toBackend: 'Zu „Backend & Status“',
        details: 'Details',
        loginAgain: 'Erneut anmelden',
        updating: 'Der Dienst wird gerade aktualisiert. Versuch es später noch einmal.',
        versionMismatch: 'Erweiterung (Version {app}) und Backend (Version {backend}) passen nicht zusammen. Aktualisiere beide auf dieselbe Version MAJOR.MINOR.',
    },
    notFound: {
        title: 'Seite nicht gefunden',
        back: 'Zu „Mein Passwort“',
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
