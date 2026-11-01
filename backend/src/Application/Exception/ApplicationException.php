<?php

declare(strict_types=1);

namespace CtPassStore\Application\Exception;

/**
 * A request the use cases refuse. The message is safe to show to the client; the error middleware maps each subclass
 * to its problem type.
 */
abstract class ApplicationException extends \RuntimeException {}
