<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\SelfCheck;

use CtPassStore\Application\Exception\ApplicationException;
use CtPassStore\Application\SelfCheck\Check;
use CtPassStore\Application\SelfCheck\CheckOutcome;
use CtPassStore\Infrastructure\ChurchTools\Exception\ChurchToolsException;
use CtPassStore\Infrastructure\Crypto\RsaPasswordCipher;
use CtPassStore\Infrastructure\Kv\KvPasswordRepository;

/**
 * The service user can create, read and delete a value in `passwordStore` (spec 4.8, `?write=1`). The test value uses
 * the reserved person ID 0 (spec 5.3.11), so it never touches a real entry. Leftovers of an earlier run are removed
 * first, and the new value is deleted in a `finally`, also when a step in between fails. The ciphertext is never shown.
 */
final class WriteRoundTripCheck implements Check
{
    public function __construct(
        private readonly KvPasswordRepository $passwords,
        private readonly RsaPasswordCipher $cipher,
    ) {}

    public function name(): string
    {
        return 'Write round trip';
    }

    public function run(): CheckOutcome
    {
        $valueId = null;
        $outcome = CheckOutcome::ok('A test value was created, read back and deleted.');
        try {
            foreach ($this->passwords->selfTestValueIds() as $leftover) {
                $this->passwords->deleteSelfTestValue($leftover);
            }

            $ciphertext = $this->cipher->encrypt('self-check');
            $valueId = $this->passwords->createSelfTestValue($ciphertext);
            if ($this->passwords->selfTestCiphertext($valueId) !== $ciphertext) {
                $outcome = CheckOutcome::fail('The test value was created but could not be read back unchanged.');
            }
        } catch (ApplicationException|ChurchToolsException|\RuntimeException $e) {
            $outcome = CheckOutcome::fail('The write round trip failed: ' . $e->getMessage());
        } finally {
            if ($valueId !== null) {
                try {
                    $this->passwords->deleteSelfTestValue($valueId);
                } catch (ApplicationException|ChurchToolsException $e) {
                    // Reported below; the next run removes the leftover.
                    $outcome = CheckOutcome::fail('The test value could not be deleted again: ' . $e->getMessage());
                }
            }
        }

        return $outcome;
    }
}
