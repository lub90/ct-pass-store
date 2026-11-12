<?php

declare(strict_types=1);

namespace CtPassStore\Application\Failure;

/**
 * Why a request failed, independent of HTTP. Every exception the backend throws on purpose carries one of these
 * (see Failure); the HTTP layer maps each reason to exactly one problem type (spec 4.9).
 */
enum Reason: string
{
    // The request is refused.
    case InvalidRequest = 'invalid-request';
    case InvalidToken = 'invalid-token';
    case TokenExpired = 'token-expired';
    case NoServiceAccess = 'no-service-access';
    case AccessDenied = 'access-denied';
    case EntryNotFound = 'entry-not-found';
    case PersonNotFound = 'person-not-found';
    case PrimaryPasswordRequired = 'primary-password-required';
    case InvalidPrimaryPassword = 'invalid-primary-password';
    case TooManyAttempts = 'too-many-attempts';
    case CustomPasswordNotAllowed = 'custom-password-not-allowed';
    case PasswordRejected = 'password-rejected';
    case OAuthCodeInvalid = 'oauth-code-invalid';

    // The backend's setup is broken. All of these are "misconfigured" for the client; the reason tells the admin more.
    case SettingsInvalid = 'settings-invalid';
    case ExtensionNotInstalled = 'extension-not-installed';
    case ServiceUserRejected = 'service-user-rejected';
    case OAuthClientRejected = 'oauth-client-rejected';
    case StoreUnusable = 'store-unusable';
    case StoreTampered = 'store-tampered';

    // ChurchTools didn't give a usable answer.
    case UpstreamUnavailable = 'upstream-unavailable';
    case UpstreamRateLimited = 'upstream-rate-limited';
    case UpstreamInvalid = 'upstream-invalid';

    /**
     * Whether ChurchTools couldn't be asked at all (network error, timeout, 5xx). Only such outages withdraw a
     * primary-password attempt (spec 6.3).
     */
    public function isOutage(): bool
    {
        return $this === self::UpstreamUnavailable;
    }
}
