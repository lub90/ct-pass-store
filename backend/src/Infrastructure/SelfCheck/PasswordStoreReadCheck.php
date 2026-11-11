<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\Kv\ExtensionData;
use CtPassStore\Infrastructure\Kv\KvSchema;

/**
 * The service user can read `passwordStore` (spec 4.8). Only the number of values is reported, never their content.
 */
final class PasswordStoreReadCheck implements Check
{
    public function __construct(private readonly ExtensionData $data) {}

    public function name(): string
    {
        return 'Password store readable';
    }

    public function run(): CheckOutcome
    {
        try {
            $count = count($this->data->values(KvSchema::PASSWORD_CATEGORY));
        } catch (ApplicationException|ChurchToolsException $e) {
            return CheckOutcome::fail('passwordStore can\'t be read: ' . $e->getMessage());
        }

        return CheckOutcome::ok("passwordStore can be read ($count values).");
    }
}
