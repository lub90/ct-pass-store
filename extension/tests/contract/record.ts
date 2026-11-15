import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFixture } from '../../scripts/sanitize-fixture.js';
import type { ContractEnv } from './setup';

const DIR = path.join(import.meta.dirname, 'fixtures');

/**
 * Keeps a response of the test instance as a fixture, only when `CT_CONTRACT_RECORD=1`, and only after
 * `sanitize-fixture.js` (names, host, tokens, hashes). The folder is gitignored; files get mode 600.
 */
export function record(env: ContractEnv, name: string, data: unknown, dir: string = DIR): void {
    if (process.env.CT_CONTRACT_RECORD !== '1') return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(sanitizeFixture(data, { host: env.host }), null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
}
