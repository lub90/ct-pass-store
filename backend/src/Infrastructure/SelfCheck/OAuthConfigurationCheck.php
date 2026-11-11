<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Config\BackendConfig;

/**
 * OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and JWT_SECRET are set, the latter long enough (spec 3.1). The ChurchTools
 * side of the OAuth client follows with the ChurchTools checks.
 */
final class OAuthConfigurationCheck implements Check
{
    public function __construct(private readonly BackendConfig $config) {}

    public function name(): string
    {
        return 'OAuth and token configuration';
    }

    public function run(): CheckOutcome
    {
        $problems = [];
        if ($this->config->oauthClientId === '') {
            $problems[] = 'OAUTH_CLIENT_ID is missing';
        }
        if ($this->config->oauthClientSecret === '') {
            $problems[] = 'OAUTH_CLIENT_SECRET is missing';
        }
        if (strlen($this->config->jwtSecret) < BackendConfig::MIN_JWT_SECRET_BYTES) {
            $problems[] = 'JWT_SECRET must have at least ' . BackendConfig::MIN_JWT_SECRET_BYTES . ' bytes';
        }
        if ($problems !== []) {
            return CheckOutcome::fail(implode('; ', $problems) . '.');
        }

        return CheckOutcome::ok('OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and JWT_SECRET are set.');
    }
}
