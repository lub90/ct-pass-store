<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

/**
 * Base class for everything that can go wrong when talking to ChurchTools.
 *
 * Messages name the method, the API path and the status, but never tokens, passwords or response bodies.
 */
abstract class ChurchToolsException extends \RuntimeException {}
