<?php

declare(strict_types=1);

namespace CtPassStore\Tests\EndToEnd;

use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Credential;
use CtPassStore\Infrastructure\ChurchTools\GuzzleChurchToolsClient;
use CtPassStore\Tests\EndToEnd\Helpers\EndToEndPrerequisites;
use CtPassStore\Tests\Support\ChurchToolsClientContractTestCase;

/**
 * The real ChurchTools test instance passes the contract the fake is built on (catalog CT-06).
 *
 * Needs the end-to-end configuration (CT_API_URL, CT_API_TOKEN, fixtures). The first user of
 * `fixtures/normal_users.json` is used for the login cases. Writes use the reserved person ID 0 and are removed.
 */
final class ChurchToolsClientContractTest extends ChurchToolsClientContractTestCase
{
    private ?GuzzleChurchToolsClient $client = null;

    public static function setUpBeforeClass(): void
    {
        EndToEndPrerequisites::assertMet();
    }

    protected function client(): ChurchToolsClient
    {
        return $this->client ??= new GuzzleChurchToolsClient((string) getenv('CT_API_URL'), $this->validUserCredential());
    }

    protected function validUserCredential(): Credential
    {
        return Credential::loginToken((string) getenv('CT_API_TOKEN'));
    }

    protected function oauthClient(): ?array
    {
        $config = require __DIR__ . '/../../config/credentials.php';
        $id = is_array($config) ? ($config['OAUTH_CLIENT_ID'] ?? null) : null;
        $secret = is_array($config) ? ($config['OAUTH_CLIENT_SECRET'] ?? null) : null;
        if (!is_string($id) || !is_string($secret) || $id === '' || $secret === '') {
            return null;
        }
        $host = (string) parse_url((string) getenv('CT_API_URL'), PHP_URL_HOST);

        return ['id' => $id, 'secret' => $secret, 'redirectUri' => "https://$host/ccm/ctpassstore/"];
    }

    protected function loginUser(): array
    {
        $users = json_decode((string) file_get_contents(__DIR__ . '/fixtures/normal_users.json'), true, 8, JSON_THROW_ON_ERROR);
        $user = $users[0] ?? null;
        self::assertIsArray($user);

        return ['username' => (string) $user['username'], 'password' => (string) $user['pwd'], 'personId' => (int) $user['id']];
    }
}
