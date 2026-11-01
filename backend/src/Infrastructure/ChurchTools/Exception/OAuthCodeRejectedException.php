<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

/**
 * ChurchTools didn't accept the authorization code: invalid, expired, already used, or the PKCE verifier or redirect
 * URI doesn't match.
 */
final class OAuthCodeRejectedException extends ChurchToolsException {}
