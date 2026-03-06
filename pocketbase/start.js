#!/usr/bin/env node
/**
 * KeiAI PocketBase — One-Click Setup & Start
 *
 * Usage:
 *   1. Copy pocketbase.config.example.json → pocketbase.config.json
 *   2. Fill in your settings (admin credentials, salt secret)
 *   3. node start.js
 *
 * What this does:
 *   • Reads pocketbase.config.json (never committed to git)
 *   • Creates / updates the admin superuser via PocketBase CLI
 *   • Starts PocketBase with DUMMY_SALT_SECRET injected as env var
 *   • All pb_migrations run automatically on startup
 */

'use strict';

const { existsSync, readFileSync } = require('fs');
const { spawnSync, spawn }         = require('child_process');
const { resolve }                  = require('path');

// ─── Config ──────────────────────────────────────────────────────────

const CONFIG_PATH  = resolve(__dirname, 'pocketbase.config.json');
const EXAMPLE_PATH = resolve(__dirname, 'pocketbase.config.example.json');

if (!existsSync(CONFIG_PATH)) {
    console.error('❌  pocketbase.config.json not found.');
    console.error(`    Copy the example and fill in your settings:`);
    console.error(`      cp "${EXAMPLE_PATH}" "${CONFIG_PATH}"`);
    process.exit(1);
}

let config;
try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
    console.error('❌  Failed to parse pocketbase.config.json:', e.message);
    process.exit(1);
}

const {
    adminEmail,
    adminPassword,
    dummySaltSecret,
    host = '127.0.0.1',
    port = 8090,
} = config;

if (!adminEmail || !adminPassword || !dummySaltSecret) {
    console.error('❌  pocketbase.config.json is missing required fields.');
    console.error('    Required: adminEmail, adminPassword, dummySaltSecret');
    process.exit(1);
}

if (dummySaltSecret.startsWith('change_me')) {
    console.error('❌  Please set a real dummySaltSecret in pocketbase.config.json.');
    process.exit(1);
}

// ─── Binary ──────────────────────────────────────────────────────────

const bin = resolve(
    __dirname,
    process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'
);

if (!existsSync(bin)) {
    console.error(`❌  PocketBase binary not found at: ${bin}`);
    console.error('    Download from https://pocketbase.io/docs/ and place it here.');
    process.exit(1);
}

const env = { ...process.env, DUMMY_SALT_SECRET: dummySaltSecret };

// ─── Create / update admin superuser ─────────────────────────────────

console.log(`🔧  Setting up admin superuser (${adminEmail})...`);

const setupResult = spawnSync(bin, ['superuser', 'upsert', adminEmail, adminPassword], {
    cwd: __dirname,
    stdio: 'inherit',
    env,
});

if (setupResult.status !== 0) {
    console.error('❌  Failed to create/update admin superuser.');
    process.exit(1);
}

// ─── Start PocketBase ─────────────────────────────────────────────────

const addr = `${host}:${port}`;

console.log('');
console.log(`🚀  Starting PocketBase on http://${addr}`);
console.log(`    Admin UI : http://${addr}/_/`);
console.log(`    API      : http://${addr}/api/`);
console.log('    Press Ctrl+C to stop.');
console.log('');

const pb = spawn(bin, ['serve', `--http=${addr}`], {
    cwd: __dirname,
    stdio: 'inherit',
    env,
});

pb.on('close', (code) => {
    process.exit(code ?? 0);
});

// Forward signals so Ctrl+C cleanly stops PocketBase
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => pb.kill(sig));
}
