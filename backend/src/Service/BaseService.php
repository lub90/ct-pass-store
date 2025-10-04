<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;
use RuntimeException;

abstract class BaseService
{
    protected LoggerInterface $logger;

    public function __construct(LoggerInterface $logger)
    {
        if ($logger === null) {
            throw new RuntimeException('Logger must not be null');
        }

        if (!$logger instanceof LoggerInterface) {
            throw new RuntimeException('Logger must implement LoggerInterface');
        }

        $this->logger = $logger;
    }
}
