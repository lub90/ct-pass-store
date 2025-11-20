<?php

namespace CtPassStore\Tests\EndToEnd\Helpers;

use PHPUnit\Framework\TestCase;
use CtPassStore\Tests\EndToEnd\Helpers\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\Helpers\BackendSandboxManager;
use CtPassStore\Config\AppConfig;
use \GuzzleHttp\Client;


abstract class AbstractTestPrototype extends TestCase {
    protected static BackendSandboxManager $thisBackend;

    protected const string AUTH_HEADER_PREFIX = 'Login ';
    protected const int WAIT_TIME_AFTER_TEST = 1;


    public static function setUpBeforeClass(): void {
        self::$thisBackend = new BackendSandboxManager();
        self::$thisBackend->start();
    }

    public static function tearDownAfterClass(): void
    {
        self::$thisBackend->stop();
    }


    protected function setUp(): void
    {
        parent::setUp();
        $this->loadSettings();
        $this->loadPublicKey();
        $this->checkPwdDatabase();
    }



    protected function tearDown(): void
    {
        parent::tearDown();
        $this->unloadSettings();
        $this->unloadPublicKey();
        $this->cleanPwdDatabase();

        // Sleep for one second to prevent 429 - too many requests...
        sleep(self::WAIT_TIME_AFTER_TEST);
    }


    protected function getClient(): Client
    {
        return new Client([
            'base_uri' => self::$thisBackend->getBaseUrl(),
            'http_errors' => false,
        ]);
    }

    public abstract function getSettingsPath(): string;

    public abstract function getPublicKeyPath(): string;

    public abstract function getPrivateKeyPath(): string;

    public function getPublicKey(): array {
        $path = $this->getPublicKeyPath();

        if (!is_readable($path)) {
            $this->fail("Settings file not found or not readable at: $path");
        }

        $rawContent = file_get_contents($path);

        $result = [];
        $result[AppConfig::CT_PUBLIC_KEY_FIELD_NAME] = $rawContent;

        return $result;
    }

    public function getPrivateKey(): string {
        $path = $this->getPrivateKeyPath();

        if (!is_readable($path)) {
            $this->fail("Settings file not found or not readable at: $path");
        }

        $rawContent = file_get_contents($path);

        return $rawContent;
    }

    public function getSettings(): array {
        $path = $this->getSettingsPath();

        if (!is_readable($path)) {
            $this->fail("Settings file not found or not readable at: $path");
        }

        $content = file_get_contents($path);
        $json = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->fail("Invalid JSON in settings file: " . json_last_error_msg());
        }

        return $json;
    }


    public function allowCustomPassword(): bool {
        return $this->getSettings()[AppConfig::CT_ALLOW_CUSTOM_PASSWORD_FIELD_NAME];
    }

    protected function requirePasswordForPasswordChange(): bool {
        return $this->getSettings()[AppConfig::CT_REQUIRE_PWD_FOR_PWD_CHANGE_FIELD_NAME];
    }

    protected function loadPublicKey(): void {
        $ct = ChurchToolsSandboxManager::getInstance();
        $publicKey = $this->getPublicKey();
        $ct->loadPublicKey($publicKey);
    }

    

    protected function loadSettings(): void {
        $ct = ChurchToolsSandboxManager::getInstance();

        $settings = $this->getSettings();

        $settings['backendUrl'] = self::$thisBackend->getBaseUrl();

        $adminUsers = array_map(fn($u) => $u['id'], $ct->getAdminUsers());
        $readAccessUsers = array_map(fn($u) => $u['id'], $ct->getReadAccessUsers());
        $settings['adminUsers'] = $adminUsers;
        $settings['readAccessUsers'] = $readAccessUsers;

        // Set settings in ct backend tests can access it
        $ct->loadSettings($settings);
    }

    protected function unloadPublicKey(): void {
        ChurchToolsSandboxManager::getInstance()->unloadPublicKey();
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

}