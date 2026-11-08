<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

use CtPassStore\Application\Port\UpstreamOutage;

/**
 * ChurchTools couldn't be reached, timed out, or answered with a server error (5xx).
 */
final class UnavailableException extends ChurchToolsException implements UpstreamOutage {}
