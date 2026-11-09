<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

/**
 * The answer of `GET /permissions/global`. Questions are answered fail closed: anything but the exact JSON value
 * `true` is "no".
 */
final class Permissions
{
    /**
     * @param array<string, mixed> $data the `data` member, per module
     */
    public function __construct(private readonly array $data) {}

    /**
     * Whether the extension's `view` permission is exactly `true` (spec 4.4.4).
     */
    public function mayView(string $module): bool
    {
        $permissions = $this->data[$module] ?? null;

        return is_array($permissions) && ($permissions['view'] ?? null) === true;
    }

    /**
     * The permissions of one module as ChurchTools sent them, or null if the module isn't there.
     *
     * @return array<mixed>|null
     */
    public function of(string $module): ?array
    {
        $permissions = $this->data[$module] ?? null;

        return is_array($permissions) ? $permissions : null;
    }
}
