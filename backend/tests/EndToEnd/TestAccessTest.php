<?php




namespace CtPassStore\Tests\EndToEnd;

use PHPUnit\Framework\TestCase;
use CtPassStore\Tests\EndToEnd\ChurchToolsSandboxManager;
use CtPassStore\Tests\EndToEnd\BackendSandboxManager;

class TestAccessTest extends TestCase
{
    private ChurchToolsSandboxManager $ctBackend;
    private BackendSandboxManager $thisBackend;

    protected function setUp(): void {
        $this->ctBackend = new ChurchToolsSandboxManager();
        $this->thisBackend = new BackendSandboxManager();

        $this->ctBackend->start();
        $this->thisBackend->start();
    }

    // TODO: This is only some test code...
    public function testBackendIsReachable(): void
    {
        $client = new \GuzzleHttp\Client([
            'base_uri' => 'http://localhost:8080',
            'http_errors' => false // verhindert Exceptions bei Statuscodes ≠ 200
        ]);

        $response = $client->get('/');
        $statusCode = $response->getStatusCode();

        $this->assertEquals(200, $statusCode, "Backend is not reachable at localhost:8080");
    }


    protected function tearDown(): void
    {
        $this->thisBackend->stop();
        $this->ctBackend->stop();
    }


}