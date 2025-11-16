<?php

namespace CtPassStore\Tests\EndToEnd\Helpers;

use PHPUnit\Framework\TestCase;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\BackendSandboxManager;
use \GuzzleHttp\Client;


abstract class AbstractTestPrototype extends TestCase {

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


    public abstract function getSettingsPath(): string;


    protected function loadSettings(): void {
        $ct = ChurchToolsSandboxManager::getInstance();

        $path = $this->getSettingsPath();

        if (!is_readable($path)) {
            $this->fail("Settings file not found or not readable at: $path");
        }

        $content = file_get_contents($path);
        $settings = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->fail("Invalid JSON in settings file: " . json_last_error_msg());
        }

        $settings['backendUrl'] = self::$thisBackend->getBaseUrl();

        
        $adminUsers = array_map(fn($u) => $u['id'], $ct->getAdminUsers());
        $readAccessUsers = array_map(fn($u) => $u['id'], $ct->getReadAccessUsers());
        $settings['adminUsers'] = $adminUsers;
        $settings['readAccessUsers'] = $readAccessUsers;

        // Set settings in ct backend tests can access it
        $ct->loadSettings($settings);
    }

    protected function unloadSettings(): void {
        ChurchToolsSandboxManager::getInstance()->unloadSettings();
    }

    protected function cleanPwdDatabase(): void {
        ChurchToolsSandboxManager::getInstance()->cleanPwdDatabase();
    }

    protected function checkPwdDatabase(): void {
        ChurchToolsSandboxManager::getInstance()->checkPwdDatabase();
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->loadSettings();
        $this->checkPwdDatabase();
    }



    protected function tearDown(): void
    {
        parent::tearDown();
        $this->unloadSettings();
        $this->cleanPwdDatabase();
    }


    protected function getClient(): Client
    {
        return new Client([
            'base_uri' => self::$thisBackend->getBaseUrl(),
            'http_errors' => false,
        ]);
    }
}