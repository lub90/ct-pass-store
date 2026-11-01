<?php

declare(strict_types=1);

namespace CtPassStore\ChurchTools\Exception;

/**
 * ChurchTools couldn't be reached, timed out, or answered with a server error (5xx).
 */
final class UnavailableException extends ChurchToolsException {}
