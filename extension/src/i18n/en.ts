import type { Messages } from './de';

const en: Messages = {
    app: {
        name: 'CtPassStore',
    },
    common: {
        save: 'Save',
        cancel: 'Cancel',
        close: 'Close',
        back: 'Back',
        loading: 'Loading …',
    },
    password: {
        defaultTitle: 'My secondary password',
        defaultIntro: "A separate password for connected services such as Wi-Fi. It's independent of your ChurchTools password.",
    },
    problems: {
        entryNotFound: 'No password yet',
        primaryPasswordRequired: 'Please enter your ChurchTools password.',
        invalidPrimaryPassword: 'The ChurchTools password is wrong.',
        passwordInvalid: 'The password does not meet the rules.',
        customPasswordNotAllowed: 'Custom passwords are not allowed right now.',
        rateLimited: 'Too many attempts. Try again in {n} minutes.',
        session: 'Your login has expired. Reload the page.',
        noServiceAccess: 'You have no access to this extension.',
        forbidden: 'You do not have permission for that.',
        personNotFound: 'This person no longer exists in ChurchTools.',
        loginFailed: 'The login did not work. Reload the page.',
        upstreamUnavailable: 'ChurchTools is not responding right now. Try again in a moment.',
        notSetUp: 'The service is not set up correctly yet.',
        generic: 'Something went wrong ({status}).',
        unreachable: 'The service cannot be reached right now. Try again in a moment.',
        unexpected: 'The service answered unexpectedly ({status}).',
    },
};

export default en;
