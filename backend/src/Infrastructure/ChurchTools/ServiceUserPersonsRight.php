<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools;

/**
 * The persons right the service user needs to tell a deleted person (`404`) from one it can't see (`403`)
 * (cleanup design 9.1). Fail closed like {@see Permissions}: anything but exactly `true` (flags) or a list of
 * integers (`view alldata`) counts as missing.
 */
final class ServiceUserPersonsRight
{
    public const DESCRIPTION = 'Personen: "Personen" sehen, "Personen eines Bereiches sehen" for every department, "Personenarchiv sehen" and "Auch versteckte Personen sehen"';

    private const MODULE = 'churchdb';

    /**
     * @param list<int> $departmentIds every department of the instance
     * @return list<string> the missing parts; empty if the right is granted
     */
    public static function missingIn(Permissions $permissions, array $departmentIds): array
    {
        $churchdb = $permissions->of(self::MODULE) ?? [];

        $missing = [];
        foreach (['view', 'view archive', 'view hidden persons'] as $flag) {
            if (($churchdb[$flag] ?? null) !== true) {
                $missing[] = self::MODULE . ' ' . $flag;
            }
        }

        $granted = $churchdb['view alldata'] ?? null;
        $granted = is_array($granted) && array_is_list($granted) && array_filter($granted, is_int(...)) === $granted ? $granted : [];
        foreach ($departmentIds as $departmentId) {
            if (!in_array($departmentId, $granted, true)) {
                $missing[] = self::MODULE . ' view alldata for department ' . $departmentId;
            }
        }

        return $missing;
    }

    /**
     * @param list<int> $departmentIds every department of the instance
     */
    public static function isGrantedIn(Permissions $permissions, array $departmentIds): bool
    {
        return self::missingIn($permissions, $departmentIds) === [];
    }
}
