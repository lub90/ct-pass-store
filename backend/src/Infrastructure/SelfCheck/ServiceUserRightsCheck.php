<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * The service user has no more rights than needed (spec 4.8; the keys were measured on a test instance on 2026-11-10):
 * none of the administrative rights of `churchcore`, and write access in `ctpassstore` to `passwordStore` only.
 * A right that isn't in the expected form counts as granted (fail closed). Messages name rights, never the person.
 */
final class ServiceUserRightsCheck implements Check
{
    private const ADMINISTRATIVE = ['administer settings', 'administer persons', 'administer custom modules'];

    private const WRITE_TO_CATEGORIES = ['create custom data', 'edit custom data', 'delete custom data'];

    private const CATEGORY_LISTS = ['edit custom category', 'delete custom category'];

    public function __construct(
        private readonly ChurchToolsClient $client,
        private readonly ExtensionData $data,
    ) {}

    public function name(): string
    {
        return 'Service user rights';
    }

    public function run(): CheckOutcome
    {
        try {
            $permissions = $this->client->serviceUserGlobalPermissions();
            $passwordStore = $this->data->categoryIdOf(KvSchema::PASSWORD_CATEGORY);
        } catch (ApplicationException|ChurchToolsException $e) {
            return CheckOutcome::fail('The service user\'s rights can\'t be read: ' . $e->getMessage());
        }

        $excess = [];
        $core = $permissions->of('churchcore') ?? [];
        foreach (self::ADMINISTRATIVE as $right) {
            if (($core[$right] ?? false) !== false) {
                $excess[] = $right;
            }
        }
        $extension = $permissions->of(KvSchema::EXTENSION_KEY) ?? [];
        if (($extension['create custom category'] ?? false) !== false) {
            $excess[] = 'create custom category';
        }
        foreach (self::CATEGORY_LISTS as $right) {
            if (($extension[$right] ?? []) !== []) {
                $excess[] = $right;
            }
        }
        foreach (self::WRITE_TO_CATEGORIES as $right) {
            $ids = $extension[$right] ?? [];
            if (!is_array($ids) || array_diff($ids, [$passwordStore]) !== []) {
                $excess[] = $right . ' (beyond passwordStore)';
            }
        }

        if ($excess !== []) {
            return CheckOutcome::fail('The service user has more rights than needed: ' . implode(', ', $excess) . '. Remove them from its role in ChurchTools.');
        }

        return CheckOutcome::ok('The service user has no administrative rights and writes to passwordStore only.');
    }
}
