<?php

declare(strict_types=1);

namespace CtPassStore\ChurchTools\Exception;

/**
 * ChurchTools answered something the backend can't use: an unexpected status, a redirect, or a body that isn't the expected JSON.
 */
final class InvalidResponseException extends ChurchToolsException {}
