<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\Exception\ConfigurationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\Exception\NotFoundException;
use CtPassStore\Infrastructure\ChurchTools\Exception\ServiceCredentialRejectedException;
use CtPassStore\Infrastructure\Kv\AccessParser;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * The service user can read the `access` category, and it names an admin group (spec 4.8). That the group exists is
 * the extension's check (extension spec 16.4); the service user gets no group right. Reads fresh, never from the cache.
 */
final class AccessCheck implements Check
{
    public function __construct(
        private readonly ExtensionData $data,
        private readonly LoggerInterface $logger = new NullLogger(),
    ) {}

    public function name(): string
    {
        return 'access';
    }

    public function run(): CheckOutcome
    {
        try {
            $values = $this->data->values(KvSchema::ACCESS_CATEGORY);
        } catch (ServiceCredentialRejectedException|NotFoundException|ConfigurationException) {
            return CheckOutcome::fail('The service user can\'t read the category access; grant it view custom category and view custom data on access.');
        } catch (ApplicationException|ChurchToolsException $e) {
            // An outage or rate limit says nothing about the rights.
            $this->logger->warning('The access check could not read the category: ' . $e->getMessage());

            return CheckOutcome::fail('ChurchTools didn\'t answer while reading access; try again.');
        }

        if (count($values) > 1) {
            return CheckOutcome::fail(sprintf('The category access holds %d values; it must hold exactly one. Remove the extra values, or run the extension\'s setup.', count($values)));
        }
        $value = $values[0]['value'] ?? null;
        $decoded = is_string($value) ? json_decode($value, true) : null;
        $groupId = AccessParser::parse(is_array($decoded) ? $decoded : null)->adminGroupId;
        if ($groupId === null) {
            return CheckOutcome::fail('access.groups.admins.groupId is missing or not a positive integer; nobody is admin until the extension\'s setup fixes it.');
        }

        return CheckOutcome::ok("The service user can read access; the admin group is $groupId.");
    }
}
