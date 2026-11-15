import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_DIR } from './setup';

/**
 * `sandbox/SandboxChurchTools.php`, the sandbox's settings and admin-group override, against a fake inner client (no
 * ChurchTools, no network). It runs in the contract suite because it needs PHP and the backend's `vendor/`, like the
 * sandbox itself. Each scenario is a PHP snippet whose last expression is printed as JSON.
 */
const PRELUDE = String.raw`
require getenv('BACKEND') . '/vendor/autoload.php';
require getenv('SANDBOX') . '/SandboxChurchTools.php';
use CtPassStore\ContractSandbox\SandboxChurchTools;
use CtPassStore\Infrastructure\ChurchTools\{ChurchToolsClient, Credential, LoginResult, Permissions, PersonStatus, WhoAmI};
$inner = new class implements ChurchToolsClient {
    public array $calls = [];
    public array $values = [];
    public function exchangeAuthorizationCode(string $a, string $b, string $c, string $d, string $e): string { $this->calls[] = 'exchange'; return 'ct-token'; }
    public function whoami(Credential $u): WhoAmI { throw new RuntimeException('unused'); }
    public function globalPermissions(Credential $u): Permissions { throw new RuntimeException('unused'); }
    public function activeGroupIds(Credential $u, int $p): array { $this->calls[] = "groups:$p"; return [7]; }
    public function serviceUserGlobalPermissions(): Permissions { throw new RuntimeException('unused'); }
    public function verifyLogin(string $u, string $p): ?LoginResult { $this->calls[] = "verify:$u"; return null; }
    public function personStatus(int $p): PersonStatus { throw new RuntimeException('unused'); }
    public function activePersonIds(array $ids): array { $this->calls[] = 'active'; return $ids; }
    public function personDepartmentIds(): array { $this->calls[] = 'departments'; return [1]; }
    public function getModuleByKey(string $k): array { $this->calls[] = "module:$k"; return ['id' => 5]; }
    public function getCategories(int $m): array { $this->calls[] = "categories:$m"; return [['id' => 10, 'name' => 'settings'], ['id' => 11, 'name' => 'access'], ['id' => 12, 'name' => 'passwordStore']]; }
    public function getValues(int $m, int $c): array { $this->calls[] = "values:$m:$c"; return $this->values[$c] ?? []; }
    public function createValue(int $m, int $c, string $v): int { $this->calls[] = "create:$c"; return 99; }
    public function updateValue(int $m, int $c, int $id, string $v): void { $this->calls[] = "update:$c:$id"; }
    public function deleteValue(int $m, int $c, int $id): void { $this->calls[] = "delete:$c:$id"; }
};
$inner->values[10] = [['id' => 1, 'dataCategoryId' => 10, 'value' => '{"requirePasswordForPasswordChange":false,"allowCustomPassword":true,"passwordLength":12,"backendUrl":"https://b.example/x"}']];
$inner->values[12] = [['id' => 2, 'dataCategoryId' => 12, 'value' => '{"personId":3,"secondaryPwd":"c"}']];
$attempt = static function (callable $f): string { try { $f(); return 'ok'; } catch (Throwable $e) { return get_class($e); } };
`;

function php(env: Record<string, string>, code: string): unknown {
    const r = spawnSync('php', ['-d', 'display_errors=stderr'], {
        input: `<?php ${PRELUDE}\n$result = (function () use ($inner, $attempt) { ${code} })();\necho json_encode($result);`,
        env: { PATH: process.env.PATH, BACKEND: BACKEND_DIR, SANDBOX: path.join(import.meta.dirname, 'sandbox'), ...env },
        encoding: 'utf8',
    });
    expect(r.stderr, 'PHP wrote to stderr').toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout) as unknown;
}

const WRAP = '$c = SandboxChurchTools::wrap($inner, getenv());';
const SETTINGS = { CPS_SANDBOX_SETTINGS: '{"requirePasswordForPasswordChange":true,"allowCustomPassword":false}', CPS_SANDBOX_SETTINGS_CATEGORY_ID: '10' };

describe('the backend sandbox override (SandboxChurchTools)', () => {
    it('without an override the real client is used as it is', () => {
        expect(php({}, `${WRAP} return $c === $inner;`)).toBe(true);
        expect(php({ CPS_SANDBOX_SETTINGS: '', CPS_SANDBOX_ADMIN_GROUP_ID: '' }, `${WRAP} return $c === $inner;`)).toBe(true);
    });

    it('refuses a malformed override, so the sandbox does not start', () => {
        const refused: Record<string, string>[] = [
            ...['[]', '[true]', 'true', '{}', 'not json', '{"passwordLength":64}', '{"allowCustomPassword":"false"}', '{"allowCustomPassword":1}', '{"adminGroupId":7}', '{"readOnly":true}', '{"allowCustomPassword":false,"passwordLength":true}'].map((s) => ({
                CPS_SANDBOX_SETTINGS: s,
                CPS_SANDBOX_SETTINGS_CATEGORY_ID: '10',
            })),
            { CPS_SANDBOX_SETTINGS: '{"allowCustomPassword":false}' },
            ...['0', '-10', '10.0', 'abc', ' 10', '1e2'].map((id) => ({ CPS_SANDBOX_SETTINGS: '{"allowCustomPassword":false}', CPS_SANDBOX_SETTINGS_CATEGORY_ID: id })),
            ...['0', '-7', '7a', '1.5'].map((id) => ({ CPS_SANDBOX_ADMIN_GROUP_ID: id })),
        ];
        for (const env of refused) expect(php(env, `return $attempt(fn () => SandboxChurchTools::wrap($inner, getenv()));`), JSON.stringify(env)).toBe('InvalidArgumentException');
    });

    it('replaces only the given settings, only in the settings category, and keeps every other value', () => {
        const values = php(SETTINGS, `${WRAP} return [$c->getValues(5, 10), $c->getValues(5, 12), $inner->calls];`) as [Record<string, unknown>[], unknown[], string[]];
        expect(values[0]).toHaveLength(1);
        expect(values[0][0]).toMatchObject({ id: 1, dataCategoryId: 10 });
        expect(JSON.parse(String(values[0][0]?.value))).toEqual({ requirePasswordForPasswordChange: true, allowCustomPassword: false, passwordLength: 12, backendUrl: 'https://b.example/x' });
        expect(values[1]).toEqual([{ id: 2, dataCategoryId: 12, value: '{"personId":3,"secondaryPwd":"c"}' }]);
        expect(values[2]).toEqual(['values:5:10', 'values:5:12']);

        const one = php({ CPS_SANDBOX_SETTINGS: '{"allowCustomPassword":false}', CPS_SANDBOX_SETTINGS_CATEGORY_ID: '10' }, `${WRAP} return json_decode($c->getValues(5, 10)[0]['value'], true);`);
        expect(one).toEqual({ requirePasswordForPasswordChange: false, allowCustomPassword: false, passwordLength: 12, backendUrl: 'https://b.example/x' });
    });

    it('leaves a settings value that is not a JSON object, and every value count, to the backend\'s own checks', () => {
        const code = `$inner->values[10] = [['id' => 1, 'value' => '[1]'], ['id' => 3, 'value' => 'x']]; ${WRAP} return $c->getValues(5, 10);`;
        expect(php(SETTINGS, code)).toEqual([
            { id: 1, value: '[1]' },
            { id: 3, value: 'x' },
        ]);
    });

    it('with an admin group, the backend sees an access category naming it (instead of the instance\'s), and no machine client', () => {
        const env = { CPS_SANDBOX_ADMIN_GROUP_ID: '7' };
        const [categories, access, settings] = php(env, `${WRAP} return [$c->getCategories(5), $c->getValues(5, SandboxChurchTools::ACCESS_CATEGORY_ID), $c->getValues(5, 10)];`) as [
            Record<string, unknown>[],
            Record<string, unknown>[],
            Record<string, unknown>[],
        ];
        expect(categories.map((c) => [c.id, c.name])).toEqual([
            [10, 'settings'],
            [12, 'passwordStore'],
            [-1, 'access'],
        ]);
        expect(access).toHaveLength(1);
        expect(JSON.parse(String(access[0]?.value))).toEqual({ groups: { admins: { groupId: 7 } }, machineClients: [] });
        // The settings stay the instance's when only the admin group is given.
        expect(JSON.parse(String(settings[0]?.value))).toMatchObject({ requirePasswordForPasswordChange: false, allowCustomPassword: true });
        // Without one, the instance's categories are listed as they are.
        expect(php(SETTINGS, `${WRAP} return array_column($c->getCategories(5), 'name');`)).toEqual(['settings', 'access', 'passwordStore']);
        expect(php(SETTINGS, `${WRAP} $c->getValues(5, -1); return $inner->calls;`)).toEqual(['values:5:-1']);
    });

    it('never writes the settings or access it overrides; other writes reach ChurchTools', () => {
        const env = { ...SETTINGS, CPS_SANDBOX_ADMIN_GROUP_ID: '7' };
        const code = `${WRAP} return [
            $attempt(fn () => $c->createValue(5, 10, '{}')), $attempt(fn () => $c->updateValue(5, 10, 1, '{}')), $attempt(fn () => $c->deleteValue(5, 10, 1)),
            $attempt(fn () => $c->createValue(5, -1, '{}')), $attempt(fn () => $c->updateValue(5, -1, -1, '{}')), $attempt(fn () => $c->deleteValue(5, -1, -1)),
            $attempt(fn () => $c->createValue(5, 12, '{}')), $attempt(fn () => $c->updateValue(5, 12, 2, '{}')), $attempt(fn () => $c->deleteValue(5, 12, 2)),
            $inner->calls];`;
        const refused = 'LogicException';
        expect(php(env, code)).toEqual([refused, refused, refused, refused, refused, refused, 'ok', 'ok', 'ok', ['create:12', 'update:12:2', 'delete:12:2']]);
        // Only the settings override: access writes are the instance's business again.
        expect(php(SETTINGS, `${WRAP} return [$attempt(fn () => $c->updateValue(5, 11, 4, '{}')), $inner->calls];`)).toEqual(['ok', ['update:11:4']]);
    });

    it('passes every other call through unchanged', () => {
        const code = `${WRAP} return [$c->exchangeAuthorizationCode('id', 's', 'code', 'r', 'v'), $c->activeGroupIds(Credential::bearerToken('t'), 4), $c->verifyLogin('u', 'p'),
            $c->activePersonIds([3, 4]), $c->personDepartmentIds(), $c->getModuleByKey('ctpassstore'), $inner->calls];`;
        expect(php({ ...SETTINGS, CPS_SANDBOX_ADMIN_GROUP_ID: '7' }, code)).toEqual(['ct-token', [7], null, [3, 4], [1], { id: 5 }, ['exchange', 'groups:4', 'verify:u', 'active', 'departments', 'module:ctpassstore']]);
    });
});
