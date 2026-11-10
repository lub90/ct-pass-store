<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\Store;

/**
 * The result of opening a signed record; `$data` is only filled for `OpenedStatus::Valid`.
 */
final readonly class OpenedRecord
{
    /**
     * @param array<string, mixed> $data
     */
    public function __construct(
        public OpenedStatus $status,
        public array $data = [],
    ) {}
}
