<?php

declare(strict_types=1);

namespace CtPassStore\Util;

/**
 * Utility class to match IP addresses against CIDR ranges or hostnames.
 */
class CIDRMatcher
{
    /**
     * Resolves a hostname or IP to a numeric IP address.
     */
    private static function resolve(string $input): ?string
    {
        $ip = gethostbyname($input);
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : null;
    }

    /**
     * Checks whether the given IP matches the CIDR or hostname range.
     *
     * @param string $clientIp IP or hostname of the client
     * @param string $cidr CIDR range or hostname with optional /mask
     * @return bool
     */
    public static function match(string $clientIp, string $cidr): bool
    {
        $resolvedClientIp = self::resolve($clientIp);
        if (!$resolvedClientIp) {
            return false;
        }

        // Handle hostname-only match (no /mask)
        if (strpos($cidr, '/') === false) {
            $resolvedCidrIp = self::resolve($cidr);
            return $resolvedCidrIp === $resolvedClientIp;
        }

        // CIDR match
        [$subnet, $mask] = explode('/', $cidr);
        $resolvedSubnet = self::resolve($subnet);
        if (!$resolvedSubnet || !is_numeric($mask)) {
            return false;
        }

        $ipLong = ip2long($resolvedClientIp);
        $subnetLong = ip2long($resolvedSubnet);
        $maskLong = ~((1 << (32 - (int)$mask)) - 1);

        return ($ipLong & $maskLong) === ($subnetLong & $maskLong);
    }
}
