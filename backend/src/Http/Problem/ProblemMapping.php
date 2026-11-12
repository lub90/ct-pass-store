<?php

declare(strict_types=1);

namespace CtPassStore\Http\Problem;

use CtPassStore\Application\Failure\Reason;

/**
 * The one place that maps failure reasons to problem types (spec 4.9). The matches have no default: a new reason
 * without a mapping is a PHPStan error, not a silent 500.
 */
final class ProblemMapping
{
    public static function type(Reason $reason): ProblemType
    {
        return match ($reason) {
            Reason::InvalidRequest => ProblemType::InvalidBody,
            Reason::InvalidToken => ProblemType::InvalidToken,
            Reason::TokenExpired => ProblemType::TokenExpired,
            Reason::NoServiceAccess => ProblemType::NoServiceAccess,
            Reason::AccessDenied => ProblemType::Forbidden,
            Reason::EntryNotFound => ProblemType::EntryNotFound,
            Reason::PersonNotFound => ProblemType::PersonNotFound,
            Reason::PrimaryPasswordRequired => ProblemType::PrimaryPasswordRequired,
            Reason::InvalidPrimaryPassword => ProblemType::InvalidPrimaryPassword,
            Reason::TooManyAttempts => ProblemType::TooManyAttempts,
            Reason::CustomPasswordNotAllowed => ProblemType::CustomPasswordNotAllowed,
            Reason::PasswordRejected => ProblemType::PasswordInvalid,
            Reason::OAuthCodeInvalid => ProblemType::OauthCodeInvalid,
            Reason::CleanupRunning => ProblemType::CleanupRunning,
            Reason::CleanupTooSoon => ProblemType::CleanupTooSoon,
            Reason::SettingsInvalid, Reason::ExtensionNotInstalled, Reason::ServiceUserRejected,
            Reason::OAuthClientRejected, Reason::StoreUnusable, Reason::StoreTampered => ProblemType::Misconfigured,
            Reason::UpstreamUnavailable => ProblemType::UpstreamUnavailable,
            Reason::UpstreamRateLimited => ProblemType::UpstreamRateLimited,
            Reason::UpstreamInvalid => ProblemType::UpstreamInvalid,
        };
    }

    /**
     * The text for the client when the failure's own message is only for the log.
     */
    public static function fixedDetail(Reason $reason): string
    {
        return match ($reason) {
            Reason::ServiceUserRejected => 'ChurchTools rejected the service user\'s token or permissions. Check CT_API_TOKEN in credentials.php and the service user\'s rights.',
            Reason::ExtensionNotInstalled => 'ChurchTools doesn\'t know the extension module or one of its categories. Check that the extension is installed and its setup completed.',
            Reason::OAuthClientRejected => 'ChurchTools rejected the backend\'s OAuth client. Check OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in credentials.php.',
            Reason::UpstreamRateLimited => 'ChurchTools limits the number of requests. Try again later.',
            Reason::UpstreamUnavailable => 'ChurchTools is unreachable or answered with an error.',
            Reason::UpstreamInvalid => 'ChurchTools answered something the backend can\'t use.',
            Reason::OAuthCodeInvalid => 'ChurchTools didn\'t accept the authorization code. Start the login again.',
            Reason::InvalidRequest, Reason::InvalidToken, Reason::TokenExpired, Reason::NoServiceAccess,
            Reason::AccessDenied, Reason::EntryNotFound, Reason::PersonNotFound, Reason::PrimaryPasswordRequired, Reason::InvalidPrimaryPassword,
            Reason::TooManyAttempts, Reason::CustomPasswordNotAllowed, Reason::PasswordRejected, Reason::CleanupRunning,
            Reason::CleanupTooSoon, Reason::SettingsInvalid,
            Reason::StoreUnusable, Reason::StoreTampered => self::type($reason)->title() . '.',
        };
    }
}
