<?php

namespace CtPassStore\Tests\EndToEnd\Helpers;

use PHPUnit\Framework\TestCase;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\BackendSandboxManager;
use \GuzzleHttp\Client;


class AbstractTestPrototype extends TestCase {

    protected static BackendSandboxManager $thisBackend;

    protected const string AUTH_HEADER_PREFIX = 'Login ';


    public static function setUpBeforeClass(): void {
        self::$thisBackend = new BackendSandboxManager();

        ChurchToolsSandboxManager::getInstance()->start();
        self::$thisBackend->start();
    }

    public static function tearDownAfterClass(): void
    {
        self::$thisBackend->stop();
        ChurchToolsSandboxManager::getInstance()->stop();
    }

    protected function getClient(): Client
    {
        return new Client([
            'base_uri' => self::$thisBackend->getBaseUrl(),
            'http_errors' => false,
        ]);
    }
}