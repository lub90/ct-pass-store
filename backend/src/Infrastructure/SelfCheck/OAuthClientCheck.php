<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Config\BackendConfig;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthClientRejectedException;
use CtPassStore\Infrastructure\ChurchTools\Exception\OAuthCodeRejectedException;

/**
 * ChurchTools accepts the OAuth client ID and secret (spec 4.8, 5.6). A made-up code is exchanged: ChurchTools
 * rejecting the code (not the client) shows that the client is known and the secret fits. Measured on 2026-11-10: a
 * wrong secret is `invalid_client`, an unknown client a `404`, a wrong code `invalid_grant`.
 */
final class OAuthClientCheck implements Check
{
    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly BackendConfig $config,
    ) {}

    public function name(): string
    {
        return 'OAuth client';
    }

    public function run(): CheckOutcome
    {
        try {
            $this->client->exchangeAuthorizationCode(
                $this->config->oauthClientId,
                $this->config->oauthClientSecret,
                'self-check-' . bin2hex(random_bytes(8)),
                $this->config->instanceOrigin() . '/ccm/ctpassstore/',
                str_repeat('v', 43),
            );
        } catch (OAuthCodeRejectedException) {
            return CheckOutcome::ok('ChurchTools knows the OAuth client and rejected a made-up code, as expected.');
        } catch (OAuthClientRejectedException) {
            return CheckOutcome::fail('ChurchTools: client ID or secret rejected. Check OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in credentials.php.');
        } catch (ChurchToolsException $e) {
            return CheckOutcome::fail('The OAuth client could not be checked: ' . $e->getMessage());
        }

        return CheckOutcome::fail('ChurchTools accepted a made-up authorization code; the OAuth client is not set up as expected.');
    }
}
