#!/usr/bin/env node
/**
 * Run the sync integration tests against two throwaway PocketBase servers.
 *
 * Uses the binary in ../pocketbase with the repository's hooks and migrations, each server
 * on its own temporary data directory, and removes everything afterwards.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appDir = resolve(import.meta.dirname, '..');
const pbDir = resolve(appDir, '../pocketbase');
const binary = join(pbDir, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
if (!existsSync(binary)) {
    console.error(`PocketBase binary not found at ${binary}`);
    process.exit(1);
}

const admin = { email: 'sync-test@example.test', password: 'SyncTest-Passw0rd!' };
// Every simulated device shares one IP, so the per-IP Pull bound rate limit is raised.
const env = {
    ...process.env,
    DUMMY_SALT_SECRET: 'sync-integration-test-secret',
    SYNC_NOW_RATE_LIMIT: '100000'
};
const servers = [];

async function start(port) {
    const dir = mkdtempSync(join(tmpdir(), 'keiai-pb-'));
    const common = ['--dir', dir, '--migrationsDir', join(pbDir, 'pb_migrations')];
    spawnSync(binary, ['superuser', 'upsert', admin.email, admin.password, ...common], {
        env,
        stdio: 'ignore'
    });
    const child = spawn(
        binary,
        ['serve', ...common, '--hooksDir', join(pbDir, 'pb_hooks'), '--http', `127.0.0.1:${port}`],
        { env, stdio: 'ignore' }
    );
    const url = `http://127.0.0.1:${port}`;
    servers.push({ child, dir });
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(`${url}/api/health`)).ok) return { url, dir };
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`PocketBase did not start on ${url}`);
}

function stop() {
    for (const { child, dir } of servers) {
        child.kill();
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            /* the process may still hold files briefly */
        }
    }
}

let status = 1;
try {
    const [first, second] = [await start(8197), await start(8198)];
    const result = spawnSync(
        process.execPath,
        [join(appDir, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/integration'],
        {
            cwd: appDir,
            stdio: 'inherit',
            env: {
                ...process.env,
                KEI_PB_URL: first.url,
                KEI_PB_URL_2: second.url,
                KEI_PB_DATA: first.dir,
                KEI_PB_DATA_2: second.dir,
                KEI_PB_ADMIN_EMAIL: admin.email,
                KEI_PB_ADMIN_PASSWORD: admin.password
            }
        }
    );
    status = result.status ?? 1;
} finally {
    stop();
}
process.exit(status);
