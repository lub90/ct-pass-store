<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

use CtPassStore\Infrastructure\ChurchTools\Exception\InvalidResponseException;

/**
 * The person of `GET /whoami`, with the two fields the backend reads. Built only from a well-formed answer.
 */
final class WhoAmI
{
    public function __construct(
        public readonly int $id,
        public readonly string $username,
    ) {}

    /**
     * @param array<string, mixed> $data the `data` member
     *
     * @throws InvalidResponseException if `id` isn't an integer or `cmsUserId` isn't a string
     */
    public static function fromData(array $data): self
    {
        $id = $data['id'] ?? null;
        $username = $data['cmsUserId'] ?? null;
        if (!is_int($id) || !is_string($username)) {
            throw new InvalidResponseException('GET whoami: unexpected person data.');
        }

        return new self($id, $username);
    }
}
