<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * Who may read or change whose entry (spec 4.5–4.7). Only depends on its arguments, so it never looks anything up.
 * The admin role is the principal's, taken from the signed token (spec 4.3, D9), never from the settings.
 */
final class AccessPolicy
{
    /**
     * Whether the entry is the principal's own.
     */
    public static function isOwner(Principal $principal, PersonId $target): bool
    {
        return $principal instanceof PersonPrincipal && $principal->id->equals($target);
    }

    public static function mayRead(Principal $principal, PersonId $target): bool
    {
        if ($principal instanceof MachinePrincipal) {
            return $principal->may(MachineClient::PERMISSION_READ_ENTRIES);
        }

        return self::isOwner($principal, $target) || self::isAdmin($principal);
    }

    /**
     * Machine clients never change entries (spec 4.3).
     */
    public static function mayChange(Principal $principal, PersonId $target): bool
    {
        return self::isOwner($principal, $target) || self::isAdmin($principal);
    }

    /**
     * Only persons can be admins; `=== true` so nothing but the boolean from the token grants it.
     */
    public static function isAdmin(Principal $principal): bool
    {
        return $principal instanceof PersonPrincipal && $principal->admin === true;
    }
}
