<?php

declare(strict_types=1);

namespace CtPassStore\Tests\Load;

use CtPassStore\Application\Auth\UserTokens;
use CtPassStore\Domain\PersonId;
use CtPassStore\Domain\PersonPrincipal;
use CtPassStore\Infrastructure\Auth\FirebaseTokenCodec;
use CtPassStore\Infrastructure\Time\SystemClock;
use CtPassStore\Tests\Contract\Helpers\ContractPrerequisites;
use CtPassStore\Tests\Load\Helpers\ChurchToolsCalls;
use CtPassStore\Tests\Load\Helpers\LoadSandbox;
use CtPassStore\Tests\Load\Helpers\Stats;
use GuzzleHttp\Client;
use GuzzleHttp\RequestOptions;
use PHPUnit\Framework\TestCase;
use Random\Randomizer;

/**
 * Load test of the backend against a real ChurchTools instance (see docs/testing.md, "Load test").
 *
 * **Run it only against a dedicated TEST instance, never against a production instance.** It creates and deletes 20
 * persons, writes up to 500 entries into `passwordStore`, archives and deletes persons and runs the cleanup job,
 * which deletes entries.
 *
 * The backend runs from a temporary sandbox ({@see LoadSandbox}) with the minimal service user's token from the local
 * phpunit.xml; the admin login token from `config/credentials.php` is used only to create, archive and delete the 20
 * load persons. All requests are sequential. Values that existed before the run (the baseline) are never changed;
 * teardown deletes exactly what the run created and checks that the baseline is what remains.
 *
 * Results go to STDERR and to a JSON file (env `LOAD_RESULTS_FILE`, default in the temp folder). They name person IDs
 * only, never names, tokens or the instance URL.
 */
final class LoadTest extends TestCase
{
    private const STAGES = [50, 200, 500];
    private const LOAD_PERSONS = 20;
    private const READ_SAMPLE = 50;
    private const PUT_SAMPLE = 20;
    private const KV_SAMPLES = 5;
    private const MAX_WEB_CALLS = 10;
    private const CLI_RECREATED = 4;
    private const CATEGORY = 'passwordStore';
    private const FIXTURES = __DIR__ . '/../Contract/fixtures/';

    private static ChurchToolsCalls $ct;
    private static ?LoadSandbox $sandbox = null;
    private static string $serviceToken = '';
    private static string $adminLoginToken = '';
    private static string $jwtSecret = '';
    private static string $cleanupToken = '';
    private static string $valuesPath = '';
    private static int $categoryId = 0;

    /** @var array<int, string> value ID => raw value, before the run */
    private static array $baseline = [];

    /** @var array<int, int> value ID => person ID, for every value this run created */
    private static array $created = [];

    /** @var list<int> */
    private static array $loadPersons = [];

    /** @var array<int, string> person ID => the ciphertext stored for them */
    private static array $stored = [];

    /** @var array<string, mixed> */
    private static array $results = [];

    /** @var array<string, mixed> the real settings, with the admin added (sandbox cache only) */
    private static array $plantedSettings = [];

    private static int $adminId = 0;

    /** @var list<int> existing persons without an entry, in random order */
    private array $candidates = [];
    private static string $adminUsername = '';

    public static function setUpBeforeClass(): void
    {
        ContractPrerequisites::assertMet();
        if (!is_readable(self::FIXTURES . 'admin_users.json')) {
            throw new \RuntimeException('The load test needs tests/Contract/fixtures/admin_users.json. See docs/testing.md.');
        }
        fwrite(STDERR, "\n[Load] Reminder: run this suite only against a dedicated TEST instance, never production. It creates and deletes persons and entries.\n");
    }

    public static function tearDownAfterClass(): void
    {
        self::cleanUpRun();
    }

    public function testLoad(): void
    {
        $this->prepare();

        foreach (self::STAGES as $stage) {
            $this->growTo($stage);
            $this->measureStage($stage);
        }

        $this->cleanupPhase();
        self::writeResults();

        self::assertSame([], self::$results['anomalies'] ?? [], 'Anomalies, see the results file.');
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------------------------------------------------

    private function prepare(): void
    {
        $apiUrl = (string) getenv('CT_API_URL');
        self::$serviceToken = (string) getenv('CT_API_TOKEN');
        /** @var array<string, mixed> $real */
        $real = require __DIR__ . '/../../config/credentials.php';
        self::assertSame(rtrim($apiUrl, '/'), rtrim((string) ($real['CT_API_URL'] ?? ''), '/'), 'config/credentials.php and phpunit.xml must point to the same test instance.');
        self::$adminLoginToken = (string) ($real['CT_API_TOKEN'] ?? '');
        self::$jwtSecret = (string) ($real['JWT_SECRET'] ?? '');
        self::$cleanupToken = bin2hex(random_bytes(32));
        self::$ct = new ChurchToolsCalls($apiUrl);
        self::$results = ['started' => date('c'), 'php' => PHP_VERSION, 'anomalies' => [], 'notes' => []];

        // KV IDs as the service user.
        $module = $this->ok('GET', 'custommodules/ctpassstore', self::$serviceToken);
        $moduleId = (int) ($module['data']['id'] ?? 0);
        foreach ($this->ok('GET', "custommodules/$moduleId/customdatacategories", self::$serviceToken)['data'] ?? [] as $category) {
            if (is_array($category) && ($category['name'] ?? null) === self::CATEGORY) {
                self::$categoryId = (int) $category['id'];
            }
        }
        self::assertGreaterThan(0, self::$categoryId, 'passwordStore not found.');
        self::$valuesPath = "custommodules/$moduleId/customdatacategories/" . self::$categoryId . '/customdatavalues';

        // Step 1: baseline.
        self::$baseline = array_map(static fn(array $v): string => $v['value'], $this->values());
        self::$results['baselineCount'] = count(self::$baseline);

        // Settings: the admin of the fixture must be in adminUsers.
        $admins = json_decode((string) file_get_contents(self::FIXTURES . 'admin_users.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($admins[0] ?? null, 'admin_users.json needs one user.');
        self::$adminId = (int) $admins[0]['id'];
        self::$adminUsername = (string) $admins[0]['username'];
        $settingsCategory = 0;
        foreach ($this->ok('GET', "custommodules/$moduleId/customdatacategories", self::$serviceToken)['data'] ?? [] as $category) {
            if (is_array($category) && ($category['name'] ?? null) === 'settings') {
                $settingsCategory = (int) $category['id'];
            }
        }
        $settingsValues = $this->ok('GET', "custommodules/$moduleId/customdatacategories/$settingsCategory/customdatavalues", self::$serviceToken)['data'] ?? [];
        self::assertCount(1, $settingsValues, 'Exactly one settings value expected.');
        $raw = json_decode((string) $settingsValues[0]['value'], true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($raw);
        $realAdmins = is_array($raw['adminUsers'] ?? null) ? $raw['adminUsers'] : [];
        self::$results['adminInRealAdminUsers'] = in_array(self::$adminId, $realAdmins, true);
        self::$results['realAdminUsersCount'] = count($realAdmins);
        self::$results['requirePrimaryPassword'] = (bool) ($raw['requirePasswordForPasswordChange'] ?? false);
        if (!self::$results['adminInRealAdminUsers']) {
            self::$results['notes'][] = 'The fixture admin is not in the instance\'s adminUsers. The run puts the real settings plus this admin into the sandbox\'s own settings cache (never into ChurchTools).';
        }
        $raw['adminUsers'] = array_values(array_unique([...$realAdmins, self::$adminId]));
        self::$plantedSettings = $raw;

        // Who must never get an entry from this run.
        $excluded = [self::$adminId => true];
        foreach (glob(self::FIXTURES . '*.json') ?: [] as $file) {
            $data = json_decode((string) file_get_contents($file), true);
            array_walk_recursive($data, static function (mixed $value, mixed $key) use (&$excluded): void {
                if (is_int($value) && ($key === 'id' || !is_int($key))) {
                    $excluded[$value] = true;
                }
            });
        }
        foreach ($realAdmins as $id) {
            $excluded[(int) $id] = true;
        }
        $who = $this->ok('GET', 'whoami', self::$serviceToken);
        $excluded[(int) ($who['data']['id'] ?? 0)] = true;
        foreach (self::$baseline as $value) {
            $excluded[(int) (json_decode($value, true)['personId'] ?? 0)] = true;
        }

        // Step 2: 20 gone persons-to-be.
        $this->createLoadPersons();

        // Candidates: existing, not archived, not excluded.
        $candidates = [];
        for ($page = 1; ; $page++) {
            $body = $this->ok('GET', "persons?limit=100&page=$page", self::$serviceToken);
            foreach ($body['data'] ?? [] as $person) {
                $id = (int) ($person['id'] ?? 0);
                if ($id > 0 && !($person['isArchived'] ?? false) && !isset($excluded[$id]) && !in_array($id, self::$loadPersons, true)) {
                    $candidates[] = $id;
                }
            }
            if ($page >= (int) ($body['meta']['pagination']['lastPage'] ?? 1)) {
                break;
            }
        }
        $this->candidates = (new Randomizer())->shuffleArray($candidates);
        self::$results['candidates'] = count($candidates);

        // The sandbox backend.
        $sandboxCredentials = $real;
        $sandboxCredentials['CT_API_TOKEN'] = self::$serviceToken;
        $sandboxCredentials['CLEANUP_TOKEN'] = self::$cleanupToken;
        foreach (['OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET'] as $key) {
            if (!isset($sandboxCredentials[$key])) {
                // Not used: the run mints backend tokens directly. Only the OAuth self-check fails.
                $sandboxCredentials[$key] = 'load-test-unused-' . bin2hex(random_bytes(4));
                self::$results['notes'][] = "$key is missing in config/credentials.php; the sandbox uses a dummy value (the OAuth self-check fails, nothing else uses it).";
            }
        }
        self::$sandbox = new LoadSandbox($sandboxCredentials, self::$jwtSecret);
        self::$sandbox->start();
    }

    private function createLoadPersons(): void
    {
        $master = $this->ok('GET', 'person/masterdata', self::$adminLoginToken)['data'] ?? [];
        $base = [
            'firstName' => 'CtPassStore',
            'departmentIds' => [(int) $master['departments'][0]['id']],
            'campusId' => (int) $master['campuses'][0]['id'],
            'statusId' => (int) $master['statuses'][0]['id'],
        ];
        $privacy = null;
        for ($i = 1; $i <= self::LOAD_PERSONS; $i++) {
            $body = $base + ['lastName' => sprintf('Load %02d', $i)] + ($privacy ?? []);
            $response = self::$ct->call('POST', 'persons', self::$adminLoginToken, $body);
            if ($response['status'] === 400 && $privacy === null) {
                $privacy = $this->privacyFields($response['body'] ?? []);
                $response = self::$ct->call('POST', 'persons', self::$adminLoginToken, $body + $privacy);
            }
            $id = (int) ($response['body']['data']['id'] ?? 0);
            self::assertContains($response['status'], [200, 201], "Creating load person $i failed with {$response['status']}.");
            self::assertGreaterThan(0, $id);
            self::$loadPersons[] = $id;
        }
        self::$results['loadPersons'] = self::$loadPersons;
        self::$results['privacyFieldsNeeded'] = $privacy !== null;
    }

    /**
     * The first valid option of each privacy field named in a 400, and today's date (specs/backend-plan.md).
     *
     * @param array<mixed> $body
     * @return array<string, int|string>
     */
    private function privacyFields(array $body): array
    {
        $fields = ['privacyPolicyAgreementDate' => date('Y-m-d')];
        foreach ($body['errors'] ?? [] as $error) {
            $options = $error['args']['validOptions'] ?? null;
            $field = (string) ($error['fieldId'] ?? $error['field'] ?? $error['args']['field'] ?? '');
            if ($options === null || !str_starts_with($field, 'privacyPolicyAgreement')) {
                continue;
            }
            $list = is_array($options) ? $options : explode(',', (string) $options);
            $fields[$field] = (int) trim((string) $list[0]);
        }
        self::assertArrayHasKey('privacyPolicyAgreementTypeId', $fields, 'The 400 when creating a person names no privacy options: ' . json_encode(array_map(static fn(mixed $e): mixed => is_array($e) ? array_keys($e) : $e, $body['errors'] ?? [])));

        return $fields;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Entries
    // ---------------------------------------------------------------------------------------------------------------

    private function growTo(int $total): void
    {
        $persons = array_keys(self::$stored);
        $todo = [];
        foreach (self::$loadPersons as $id) {
            if (!in_array($id, $persons, true)) {
                $todo[] = $id;
            }
        }
        while (count($persons) + count($todo) < $total && $this->candidates !== []) {
            $todo[] = (int) array_shift($this->candidates);
        }
        if (count($persons) + count($todo) < $total) {
            self::$results['notes'][] = 'Only ' . (count($persons) + count($todo)) . " persons available for stage $total.";
        }
        $start = hrtime(true);
        foreach ($todo as $person) {
            $this->createEntry($person);
        }
        self::$results['stages'][$total]['createMs'] = round((hrtime(true) - $start) / 1e6);
        self::$results['stages'][$total]['entries'] = count(self::$stored);
        $this->checkStore();
    }

    private function createEntry(int $person): void
    {
        $ciphertext = base64_encode(random_bytes(512));
        $response = self::$ct->call('POST', self::$valuesPath, self::$serviceToken, [
            'dataCategoryId' => self::$categoryId,
            'value' => json_encode(['personId' => $person, 'secondaryPwd' => $ciphertext], JSON_THROW_ON_ERROR),
        ]);
        $id = (int) ($response['body']['data']['id'] ?? 0);
        self::assertContains($response['status'], [200, 201], "Creating an entry failed with {$response['status']}.");
        self::assertGreaterThan(0, $id);
        self::assertArrayNotHasKey($id, self::$baseline);
        self::$created[$id] = $person;
        self::$stored[$person] = $ciphertext;
    }

    /**
     * Stops the run if the baseline changed or a value appeared that this run didn't create; adopts values the
     * backend created for this run's persons (a PUT may create one).
     *
     * @return array<int, int> value ID => person ID of every value now in the store
     */
    private function checkStore(): array
    {
        $now = [];
        foreach ($this->values() as $id => $value) {
            $now[$id] = (int) (json_decode($value['value'], true)['personId'] ?? 0);
            if (isset(self::$baseline[$id])) {
                self::assertSame(self::$baseline[$id], $value['value'], "Baseline value $id changed by someone else; stopping.");

                continue;
            }
            if (!isset(self::$created[$id])) {
                self::assertArrayHasKey($now[$id], self::$stored, "Value $id appeared that this run didn't create; stopping.");
                self::$created[$id] = $now[$id];
            }
        }
        foreach (array_keys(self::$baseline) as $id) {
            self::assertArrayHasKey($id, $now, "Baseline value $id disappeared; stopping.");
        }

        return $now;
    }

    /**
     * @return array<int, array{value: string, person: int}>
     */
    private function values(): array
    {
        $values = [];
        foreach ($this->ok('GET', self::$valuesPath, self::$serviceToken)['data'] ?? [] as $value) {
            $values[(int) $value['id']] = ['value' => (string) $value['value'], 'person' => (int) (json_decode((string) $value['value'], true)['personId'] ?? 0)];
        }

        return $values;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Measurements
    // ---------------------------------------------------------------------------------------------------------------

    private function measureStage(int $stage): void
    {
        $sandbox = $this->sandbox();
        $result = &self::$results['stages'][$stage];
        $persons = array_keys(self::$stored);
        $randomizer = new Randomizer();
        $sample = array_slice($randomizer->shuffleArray($persons), 0, self::READ_SAMPLE);

        // The KV list alone, as the service user: the part every read and write pays.
        $kv = [];
        for ($i = 0; $i < self::KV_SAMPLES; $i++) {
            $response = self::$ct->call('GET', self::$valuesPath, self::$serviceToken);
            $kv[] = $response['ms'];
            $result['kvListBytes'] = $response['bytes'];
        }
        $result['kvList'] = Stats::of($kv);
        // One person lookup, as the existence check makes it.
        $lookups = [];
        foreach (array_slice($sample, 0, self::KV_SAMPLES) as $person) {
            $lookups[] = self::$ct->call('GET', "persons/$person", self::$serviceToken)['ms'];
        }
        $result['personLookup'] = Stats::of($lookups);

        // PHP bootstrap without any ChurchTools call: an unauthenticated request.
        $bare = [];
        for ($i = 0; $i < self::KV_SAMPLES; $i++) {
            $bare[] = $this->backend('GET', '/v1/entries/' . $sample[0], null, null, 401)['ms'];
        }
        $result['noAuth401'] = Stats::of($bare);

        $sandbox->plantSettings(self::$plantedSettings);
        $token = $this->adminToken();
        // Warms the ID cache (module, categories) with one request outside the sample.
        $this->backend('GET', '/v1/entries/' . $persons[array_key_last($persons)], $token, null, 200);

        $sandbox->clearPersonsCache();
        $uncached = [];
        foreach ($sample as $person) {
            $uncached[] = $this->read($person, $token);
        }
        $result['readUncached'] = Stats::of($uncached);

        $cached = [];
        foreach ($sample as $person) {
            $cached[] = $this->read($person, $token);
        }
        $result['readCached'] = Stats::of($cached);

        // Writes, on entries this run created for existing persons.
        $sandbox->plantSettings(self::$plantedSettings);
        $token = $this->adminToken();
        $writable = array_values(array_diff($persons, self::$loadPersons));
        $puts = [];
        foreach (array_slice($randomizer->shuffleArray($writable), 0, self::PUT_SAMPLE) as $person) {
            $body = ['secondaryPwd' => 'Load-' . bin2hex(random_bytes(4)) . '!1a'];
            $puts[] = $this->backend('PUT', "/v1/entries/$person", $token, $body, 204)['ms'];
            $get = $this->backend('GET', "/v1/entries/$person", $token, null, 200);
            self::$stored[$person] = (string) ($get['body']['secondaryPwd'] ?? '');
        }
        $result['put'] = Stats::of($puts);
        $after = $this->checkStore();
        $perPerson = array_count_values($after);
        foreach ($persons as $person) {
            if (($perPerson[$person] ?? 0) !== 1) {
                self::$results['anomalies'][] = "Stage $stage: person $person has " . ($perPerson[$person] ?? 0) . ' entries after the writes.';
            }
        }

        $start = hrtime(true);
        $test = $this->backend('GET', '/v1/test', $token, null, null);
        $result['selfTestMs'] = round((hrtime(true) - $start) / 1e6, 1);
        $result['selfTestStatus'] = $test['status'];
        $failed = [];
        foreach ($test['body']['tests'] ?? [] as $check) {
            if (($check['status'] ?? '') !== 'ok') {
                $failed[] = (string) ($check['name'] ?? '?');
            }
        }
        $result['selfTestFailedChecks'] = $failed;
        // The self-check reloads the real settings; put the admin back for what follows.
        $sandbox->plantSettings(self::$plantedSettings);

        unset($result);
        self::writeResults();
        $this->report("stage $stage done");
    }

    private function read(int $person, string $token): float
    {
        $response = $this->backend('GET', "/v1/entries/$person", $token, null, 200);
        if (($response['body']['secondaryPwd'] ?? null) !== self::$stored[$person]) {
            self::$results['anomalies'][] = "GET of person $person returned another ciphertext than stored.";
        }

        return $response['ms'];
    }

    private function adminToken(): string
    {
        return (new UserTokens(self::$jwtSecret, new SystemClock(), new FirebaseTokenCodec()))
            ->issue(new PersonPrincipal(new PersonId(self::$adminId), self::$adminUsername))->token;
    }

    /**
     * One request to the sandbox backend. A 502/503 from it (ChurchTools unavailable or rate limiting) is recorded,
     * waited out and retried once; the retried request's time counts.
     *
     * @param array<string, mixed>|null $json
     * @return array{status: int, body: array<mixed>|null, ms: float}
     */
    private function backend(string $method, string $path, ?string $bearer, ?array $json, ?int $expected): array
    {
        $http = new Client(['base_uri' => $this->sandbox()->baseUrl(), RequestOptions::HTTP_ERRORS => false, RequestOptions::TIMEOUT => 120]);
        $options = [RequestOptions::HEADERS => []];
        if ($bearer !== null) {
            $options[RequestOptions::HEADERS]['Authorization'] = 'Bearer ' . $bearer;
        }
        if ($json !== null) {
            $options[RequestOptions::JSON] = $json;
        }
        for ($attempt = 1; ; $attempt++) {
            $start = hrtime(true);
            $response = $http->request($method, $path, $options);
            $ms = (hrtime(true) - $start) / 1e6;
            $raw = (string) $response->getBody();
            $body = json_decode($raw, true);
            $status = $response->getStatusCode();
            if (in_array($status, [502, 503], true) && $attempt === 1) {
                $wait = max(5, (int) $response->getHeaderLine('Retry-After'));
                self::$ct->events[] = sprintf('%s backend %s %s: %d %s, waited %d s', date('H:i:s'), $method, preg_replace('/\d+/', '{n}', $path), $status, (string) ($body['type'] ?? ''), $wait);
                sleep($wait);

                continue;
            }
            if ($expected !== null) {
                self::assertSame($expected, $status, "$method " . preg_replace('/\d+/', '{n}', $path) . ': ' . substr($raw, 0, 300));
            }

            return ['status' => $status, 'body' => is_array($body) ? $body : null, 'ms' => $ms];
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------------------------------------------------------

    private function cleanupPhase(): void
    {
        $sandbox = $this->sandbox();
        $result = [];
        $archived = array_slice(self::$loadPersons, 0, self::LOAD_PERSONS / 2);
        $deleted = array_slice(self::$loadPersons, self::LOAD_PERSONS / 2);
        foreach ($archived as $id) {
            self::assertContains(self::$ct->call('POST', "persons/$id/archive", self::$adminLoginToken)['status'], [200, 201, 204], "Archiving $id failed.");
        }
        foreach ($deleted as $id) {
            self::assertContains(self::$ct->call('DELETE', "persons/$id", self::$adminLoginToken)['status'], [200, 204], "Deleting $id failed.");
        }
        $before = $this->checkStore();
        $result['entriesBefore'] = count($before);

        // Web cron: dry run, then apply until complete.
        $sandbox->plantSettings(self::$plantedSettings);
        $sandbox->clearCleanupCooldown();
        $dry = $this->backend('POST', '/v1/cleanup', self::$cleanupToken, null, 200);
        $result['webDryRun'] = ['ms' => round($dry['ms'], 1), 'body' => $dry['body']];
        $result['webApply'] = [];
        for ($call = 1; $call <= self::MAX_WEB_CALLS; $call++) {
            $sandbox->plantSettings(self::$plantedSettings);
            $result['cooldownRecordFound'][] = $sandbox->clearCleanupCooldown();
            $apply = $this->backend('POST', '/v1/cleanup?apply=1', self::$cleanupToken, null, 200);
            $result['webApply'][] = ['ms' => round($apply['ms'], 1), 'body' => $apply['body']];
            if (($apply['body']['complete'] ?? false) === true) {
                break;
            }
        }
        $after = $this->checkStore();
        $result += $this->compare($before, $after, self::$loadPersons, 'web apply');

        // CLI: a dry run confirms nothing is left; then a few gone-person entries again, so the CLI has work.
        $sandbox->plantSettings(self::$plantedSettings);
        $result['cliDryRunEmpty'] = self::cli($sandbox->runCleanupScript([]));
        $recreated = [...array_slice($archived, 0, self::CLI_RECREATED / 2), ...array_slice($deleted, 0, self::CLI_RECREATED / 2)];
        foreach ($recreated as $person) {
            $this->createEntry($person);
        }
        $before = $this->checkStore();
        $result['cliDryRun'] = self::cli($sandbox->runCleanupScript([]));
        $sandbox->plantSettings(self::$plantedSettings);
        $result['cliApply'] = self::cli($sandbox->runCleanupScript(['--apply']));
        $after = $this->checkStore();
        $cli = $this->compare($before, $after, $recreated, 'CLI apply');
        $result['cliRemovedGone'] = $cli['removedGone'];
        $result['cliRemovedOther'] = $cli['removedOther'];

        self::$results['cleanup'] = $result;
    }

    /**
     * @param array<int, int> $before
     * @param array<int, int> $after
     * @param list<int> $gone
     * @return array{removedGone: int, removedOther: int, goneLeft: int}
     */
    private function compare(array $before, array $after, array $gone, string $what): array
    {
        $removedGone = 0;
        $removedOther = 0;
        foreach ($before as $id => $person) {
            if (isset($after[$id])) {
                continue;
            }
            if (in_array($person, $gone, true)) {
                $removedGone++;
            } else {
                $removedOther++;
                self::$results['anomalies'][] = "$what removed value $id of person $person, who isn't gone.";
            }
        }
        $goneLeft = count(array_filter($after, static fn(int $person): bool => in_array($person, self::$loadPersons, true)));
        if ($goneLeft > 0) {
            self::$results['anomalies'][] = "$what left $goneLeft entries of gone persons.";
        }

        return ['removedGone' => $removedGone, 'removedOther' => $removedOther, 'goneLeft' => $goneLeft];
    }

    /**
     * @param array{exit: int, output: string, ms: float} $run
     * @return array{exit: int, ms: float, lines: int, summary: string}
     */
    private static function cli(array $run): array
    {
        $lines = array_values(array_filter(explode("\n", trim($run['output']))));

        return ['exit' => $run['exit'], 'ms' => round($run['ms'], 1), 'lines' => count($lines), 'summary' => (string) end($lines)];
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Teardown
    // ---------------------------------------------------------------------------------------------------------------

    private static function cleanUpRun(): void
    {
        if (!isset(self::$ct) || self::$categoryId === 0) {
            return;
        }
        $teardown = ['deletedValues' => 0, 'notFound' => 0, 'deletedPersons' => 0, 'errors' => []];
        try {
            $current = [];
            foreach (self::$ct->call('GET', self::$valuesPath, self::$serviceToken)['body']['data'] ?? [] as $value) {
                $current[(int) $value['id']] = (int) (json_decode((string) $value['value'], true)['personId'] ?? 0);
            }
            // Values the backend created for this run's persons (a PUT) count as created.
            $ours = self::$created;
            foreach ($current as $id => $person) {
                if (!isset(self::$baseline[$id]) && (isset(self::$stored[$person]) || in_array($person, self::$loadPersons, true))) {
                    $ours[$id] = $person;
                }
            }
            foreach (array_keys($ours) as $id) {
                if (isset(self::$baseline[$id])) {
                    continue; // never
                }
                $status = self::$ct->call('DELETE', self::$valuesPath . '/' . $id, self::$serviceToken)['status'];
                if ($status === 404) {
                    $teardown['notFound']++;
                } elseif ($status >= 200 && $status < 300) {
                    $teardown['deletedValues']++;
                } else {
                    $teardown['errors'][] = "DELETE value $id: $status";
                }
            }
        } catch (\Throwable $e) {
            $teardown['errors'][] = 'values: ' . $e->getMessage();
        }
        foreach (self::$loadPersons as $id) {
            try {
                $status = self::$ct->call('DELETE', "persons/$id", self::$adminLoginToken)['status'];
                if ($status >= 400 && $status !== 404) {
                    // An archived person may have to be brought back first.
                    self::$ct->call('POST', "persons/$id/unarchive", self::$adminLoginToken);
                    $status = self::$ct->call('DELETE', "persons/$id", self::$adminLoginToken)['status'];
                }
                $after = self::$ct->call('GET', "persons/$id", self::$adminLoginToken)['status'];
                if ($after === 404) {
                    $teardown['deletedPersons']++;
                } else {
                    $teardown['errors'][] = "person $id still answers $after after DELETE ($status)";
                }
            } catch (\Throwable $e) {
                $teardown['errors'][] = "person $id: " . $e->getMessage();
            }
        }
        self::$sandbox?->stopAndRemove();
        $teardown['sandboxRemoved'] = self::$sandbox === null || !is_dir(self::$sandbox->folder);

        try {
            $final = [];
            foreach (self::$ct->call('GET', self::$valuesPath, self::$serviceToken)['body']['data'] ?? [] as $value) {
                $final[(int) $value['id']] = (string) $value['value'];
            }
            ksort($final);
            $baseline = self::$baseline;
            ksort($baseline);
            $teardown['verified'] = $final === $baseline;
            $teardown['finalCount'] = count($final);
        } catch (\Throwable $e) {
            $teardown['verified'] = false;
            $teardown['errors'][] = 'verify: ' . $e->getMessage();
        }
        self::$results['teardown'] = $teardown;
        self::$results['events'] = self::$ct->events;
        self::$results['finished'] = date('c');
        self::writeResults();
        fwrite(STDERR, "\n[Load] teardown: " . json_encode($teardown) . "\n");
        if (!$teardown['verified']) {
            fwrite(STDERR, "\n[Load] !!! TEARDOWN VERIFICATION FAILED: passwordStore doesn't equal the baseline. Check it by hand. !!!\n");
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------

    /**
     * @param array<string, mixed>|null $json
     * @return array<mixed>
     */
    private function ok(string $method, string $path, string $token, ?array $json = null): array
    {
        $response = self::$ct->call($method, $path, $token, $json);
        self::assertSame(200, $response['status'], $method . ' ' . preg_replace('/\d+/', '{n}', explode('?', $path)[0]) . " answered {$response['status']}.");

        return $response['body'] ?? [];
    }

    private function sandbox(): LoadSandbox
    {
        return self::$sandbox ?? throw new \LogicException('No sandbox.');
    }

    private function report(string $what): void
    {
        fwrite(STDERR, "\n[Load] $what: " . json_encode(self::$results['stages'] ?? []) . "\n");
    }

    private static function writeResults(): void
    {
        $file = (string) (getenv('LOAD_RESULTS_FILE') ?: sys_get_temp_dir() . '/ctps-load-results.json');
        file_put_contents($file, json_encode(self::$results, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    }
}
