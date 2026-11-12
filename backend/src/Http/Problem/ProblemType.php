<?php

declare(strict_types=1);

namespace CtPassStore\Http\Problem;

/**
 * Every kind of problem the API can report (spec 4.9). The value is the slug used in the `type` URI.
 *
 * Each type is documented in `backend/docs/problems.md`; a unit test keeps the two in sync.
 */
enum ProblemType: string
{
    public const TYPE_BASE_URI = 'https://github.com/lub90/ct-pass-store/blob/main/backend/docs/problems.md#';

    case HttpsRequired = 'https-required';
    case InvalidId = 'invalid-id';
    case InvalidBody = 'invalid-body';
    case OauthCodeInvalid = 'oauth-code-invalid';
    case PrimaryPasswordRequired = 'primary-password-required';
    case CustomPasswordNotAllowed = 'custom-password-not-allowed';
    case PasswordInvalid = 'password-invalid';
    case MissingToken = 'missing-token';
    case InvalidToken = 'invalid-token';
    case TokenExpired = 'token-expired';
    case NoServiceAccess = 'no-service-access';
    case Forbidden = 'forbidden';
    case InvalidPrimaryPassword = 'invalid-primary-password';
    case NotFound = 'not-found';
    case EntryNotFound = 'entry-not-found';
    case PersonNotFound = 'person-not-found';
    case MethodNotAllowed = 'method-not-allowed';
    case PayloadTooLarge = 'payload-too-large';
    case UnsupportedMediaType = 'unsupported-media-type';
    case TooManyAttempts = 'too-many-attempts';
    case Misconfigured = 'misconfigured';
    case InternalError = 'internal-error';
    case UpstreamUnavailable = 'upstream-unavailable';
    case UpstreamInvalid = 'upstream-invalid';
    case UpstreamRateLimited = 'upstream-rate-limited';

    public function uri(): string
    {
        return self::TYPE_BASE_URI . $this->value;
    }

    public function status(): int
    {
        return match ($this) {
            self::HttpsRequired, self::InvalidId, self::InvalidBody, self::OauthCodeInvalid, self::PrimaryPasswordRequired,
            self::CustomPasswordNotAllowed, self::PasswordInvalid => 400,
            self::MissingToken, self::InvalidToken, self::TokenExpired => 401,
            self::NoServiceAccess, self::Forbidden, self::InvalidPrimaryPassword => 403,
            self::NotFound, self::EntryNotFound, self::PersonNotFound => 404,
            self::MethodNotAllowed => 405,
            self::PayloadTooLarge => 413,
            self::UnsupportedMediaType => 415,
            self::TooManyAttempts => 429,
            self::Misconfigured, self::InternalError => 500,
            self::UpstreamUnavailable, self::UpstreamInvalid => 502,
            self::UpstreamRateLimited => 503,
        };
    }

    public function title(): string
    {
        return match ($this) {
            self::HttpsRequired => 'HTTPS required',
            self::InvalidId => 'Invalid person ID',
            self::InvalidBody => 'Invalid request body',
            self::OauthCodeInvalid => 'Invalid authorization code',
            self::PrimaryPasswordRequired => 'Primary password required',
            self::CustomPasswordNotAllowed => 'Custom passwords not allowed',
            self::PasswordInvalid => 'Password doesn\'t meet the policy',
            self::MissingToken => 'Missing access token',
            self::InvalidToken => 'Invalid access token',
            self::TokenExpired => 'Access token expired',
            self::NoServiceAccess => 'No access to the service',
            self::Forbidden => 'Not allowed',
            self::InvalidPrimaryPassword => 'Wrong primary password',
            self::NotFound => 'Unknown endpoint',
            self::EntryNotFound => 'No password entry',
            self::PersonNotFound => 'Person not found',
            self::MethodNotAllowed => 'Method not allowed',
            self::PayloadTooLarge => 'Request body too large',
            self::UnsupportedMediaType => 'Unsupported content type',
            self::TooManyAttempts => 'Too many attempts',
            self::Misconfigured => 'Backend misconfigured',
            self::InternalError => 'Internal error',
            self::UpstreamUnavailable => 'ChurchTools unavailable',
            self::UpstreamInvalid => 'Unexpected answer from ChurchTools',
            self::UpstreamRateLimited => 'ChurchTools rate limit reached',
        };
    }
}
