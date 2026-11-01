<?php

declare(strict_types=1);

namespace CtPassStore\Service;

use Psr\Log\LoggerInterface;

/**
 * Base class for services that read or write the extension's data in ChurchTools.
 */
abstract class ChurchToolsBaseService extends BaseService
{
    public function __construct(
        protected readonly ExtensionDataService $extension,
        LoggerInterface $logger,
    ) {
        parent::__construct($logger);
    }
}
