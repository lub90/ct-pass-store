<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\Kv\AccessParser;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * The service user can read the `access` category, and it names an admin group (spec 4.8). That the group exists is
 * the extension's check (extension spec 16.4); the service user gets no group right. Reads fresh, never from the cache.
 */
final class AccessCheck implements Check
{
    public function __construct(private readonly ExtensionData $data) {}

    public function name(): string
    {
        return 'access';
    }

    public function run(): CheckOutcome
    {
        try {
            $values = $this->data->values(KvSchema::ACCESS_CATEGORY);
        } catch (ApplicationException|ConfigurationException|ChurchToolsException) {
            return CheckOutcome::fail('The service user can\'t read the category access; grant it view custom category and view custom data on access.');
        }

        $value = count($values) === 1 ? ($values[0]['value'] ?? null) : null;
        $decoded = is_string($value) ? json_decode($value, true) : null;
        $groupId = AccessParser::parse(is_array($decoded) ? $decoded : null)->adminGroupId;
        if ($groupId === null) {
            return CheckOutcome::fail('access.groups.admins.groupId is missing or not a positive integer; nobody is admin until the extension\'s setup fixes it.');
        }

        return CheckOutcome::ok("The service user can read access; the admin group is $groupId.");
    }
}
