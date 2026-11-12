<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\ChurchTools\ChurchToolsClient;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\ChurchTools\ServiceUserPersonsRight;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * The service user has no more rights than needed (spec 4.8; the keys were measured on a test instance on 2026-11-10):
 * none of the administrative rights of `churchcore`, write access in `ctpassstore` to `passwordStore` only, and in
 * `churchdb` nothing that writes, creates, deletes, exports or administers, and no person security level above 1.
 * It also needs the persons right ({@see ServiceUserPersonsRight}).
 *
 * Both directions fail closed. For the excess rights, anything unexpected counts as **granted**: a flag or list that
 * isn't exactly `false` or `[]`, or a category list that isn't a list of IDs within `passwordStore`. For the persons
 * right, anything unexpected counts as **missing**. Messages name rights, never the person.
 *
 * The `churchdb` part is a deny-list on purpose (cleanup design 9.1): ChurchTools gives every user default read values
 * there (e.g. `security level view own data`, `view group`), which an allow-list would reject.
 */
final class ServiceUserRightsCheck implements Check
{
    private const ADMINISTRATIVE = ['administer settings', 'administer persons', 'administer custom modules'];

    private const WRITE_TO_CATEGORIES = ['create custom data', 'edit custom data', 'delete custom data'];

    private const CATEGORY_LISTS = ['edit custom category', 'delete custom category'];

    /** The `churchdb` rights that write, create, delete, export or administer; each must be exactly `false` or `[]`. */
    private const CHURCHDB_EXCESS = [
        'create person',
        'write access',
        'delete persons',
        'edit person visibility',
        'push/pull archive',
        'export data',
        'edit bulkletter',
        'create print labels',
        'send sms',
        'edit relations',
        'administer global filters',
        'edit masterdata',
        'edit group',
        'delete group',
        'create groups of grouptype',
        'edit groups of grouptype',
        'delete groups of grouptype',
        'edit group memberships of grouptype',
        'edit group memberships of group',
        'administer groups',
        'edit group memberships',
    ];

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
            $missingPersonsRight = ServiceUserPersonsRight::missingIn($permissions, $this->client->personDepartmentIds());
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
        $churchdb = $permissions->of('churchdb') ?? [];
        foreach (self::CHURCHDB_EXCESS as $right) {
            if (array_key_exists($right, $churchdb) && $churchdb[$right] !== false && $churchdb[$right] !== []) {
                $excess[] = 'churchdb ' . $right;
            }
        }
        $levels = $churchdb['security level person'] ?? [];
        if (!is_array($levels) || !array_is_list($levels) || array_filter($levels, static fn(mixed $level): bool => $level !== 1) !== []) {
            $excess[] = 'churchdb security level person above 1';
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

        $problems = [];
        if ($missingPersonsRight !== []) {
            $problems[] = 'The service user can\'t read persons (missing: ' . implode(', ', $missingPersonsRight) . '); the cleanup job and the existence checks need it (see docs/setup.md).';
        }
        if ($excess !== []) {
            $problems[] = 'The service user has more rights than needed: ' . implode(', ', $excess) . '. Remove them from its role in ChurchTools.';
        }
        if ($problems !== []) {
            return CheckOutcome::fail(implode(' ', $problems));
        }

        return CheckOutcome::ok('The service user has no administrative rights, writes to passwordStore only and can read persons.');
    }
}
