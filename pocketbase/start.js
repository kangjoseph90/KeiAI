#!/usr/bin/env node
/**
 * KeiAI PocketBase — One-Click Setup & Start
 *
 * Usage:
 *   1. Configure your settings in project root .env
 *   2. node start.js
 *
 * What this does:
 *   • Reads project root .env
 *   • Creates / updates the admin superuser via PocketBase CLI
 *   • Starts PocketBase with constants injected via env vars
 *   • All pb_migrations run automatically on startup
 */

"use strict";

const { existsSync, readFileSync } = require("fs");
const { spawnSync, spawn } = require("child_process");
const { resolve } = require("path");

// ─── Environment ──────────────────────────────────────────────────────

const ENV_PATH = resolve(__dirname, "../.env");
if (existsSync(ENV_PATH)) {
  const envContent = readFileSync(ENV_PATH, "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim();
    if (key && value) {
      process.env[key.trim()] = value;
    }
  });
}

// ─── Environment Configuration ──────────────────────────────────────────

const adminEmail = process.env.PB_ADMIN_EMAIL;
const adminPassword = process.env.PB_ADMIN_PASSWORD;
const dummySaltSecret = process.env.DUMMY_SALT_SECRET;
const host = process.env.PB_HOST;
const port = process.env.PB_PORT;

if (!adminEmail || !adminPassword || !dummySaltSecret || !host || !port) {
  console.error(
    "❌  Missing required environment variables in project root .env",
  );
  console.error(
    "    Required: PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD, DUMMY_SALT_SECRET, PB_HOST, PB_PORT",
  );
  process.exit(1);
}

if (dummySaltSecret.startsWith("change_me")) {
  console.error("❌  Please set a real DUMMY_SALT_SECRET in project root .env");
  process.exit(1);
}

// ─── Binary ──────────────────────────────────────────────────────────

const bin = resolve(
  __dirname,
  process.platform === "win32" ? "pocketbase.exe" : "pocketbase",
);

if (!existsSync(bin)) {
  console.error(`❌  PocketBase binary not found at: ${bin}`);
  console.error(
    "    Download from https://pocketbase.io/docs/ and place it here.",
  );
  process.exit(1);
}

const env = { ...process.env, DUMMY_SALT_SECRET: dummySaltSecret };

// ─── Create / update admin superuser ─────────────────────────────────

console.log(`🔧  Setting up admin superuser (${adminEmail})...`);

const setupResult = spawnSync(
  bin,
  ["superuser", "upsert", adminEmail, adminPassword],
  {
    cwd: __dirname,
    stdio: "inherit",
    env,
  },
);

if (setupResult.status !== 0) {
  console.error("❌  Failed to create/update admin superuser.");
  process.exit(1);
}

// ─── Start PocketBase ─────────────────────────────────────────────────

const addr = `${host}:${port}`;

console.log("");
console.log(`🚀  Starting PocketBase on http://${addr}`);
console.log(`    Admin UI : http://${addr}/_/`);
console.log(`    API      : http://${addr}/api/`);
console.log("    Press Ctrl+C to stop.");
console.log("");

const pb = spawn(bin, ["serve", `--http=${addr}`], {
  cwd: __dirname,
  stdio: "inherit",
  env,
});

pb.on("close", (code) => {
  process.exit(code == null ? 0 : code);
});

// Forward signals so Ctrl+C cleanly stops PocketBase
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => pb.kill(sig));
}
