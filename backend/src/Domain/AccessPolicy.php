<?php

declare(strict_types=1);

namespace CtPassStore\Domain;

/**
 * Who may read or change whose entry (spec 4.5–4.7). Only depends on its arguments, so it never looks anything up.
 */
final class AccessPolicy
{
    /**
     * Whether the entry is the principal's own. Needs no settings, so callers can skip loading them.
     */
    public static function isOwner(Principal $principal, PersonId $target): bool
    {
        return $principal instanceof PersonPrincipal && $principal->id->equals($target);
    }

    public static function mayRead(Principal $principal, PersonId $target, Settings $settings): bool
    {
        return self::isOwner($principal, $target)
            || ($principal instanceof PersonPrincipal && ($settings->isAdmin($principal->id) || $settings->hasReadAccess($principal->id)));
    }

    public static function mayChange(Principal $principal, PersonId $target, Settings $settings): bool
    {
        return self::isOwner($principal, $target)
            || ($principal instanceof PersonPrincipal && $settings->isAdmin($principal->id));
    }
}
