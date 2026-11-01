<?php

declare(strict_types=1);

namespace CtPassStore\Infrastructure\ChurchTools\Exception;

/**
 * ChurchTools answered 401 to a call made with a user's credential.
 */
final class NotAuthenticatedException extends ChurchToolsException {}
