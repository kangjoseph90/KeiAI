// Tombstone cost benchmark against a real PocketBase with the repository's schema and hooks.
// Usage: node tombstone_bench.mjs <repoRoot>
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";
import { webcrypto as crypto } from "node:crypto";

const repo = process.argv[2];
const pbDir = join(repo, "pocketbase");
const binary = join(
  pbDir,
  process.platform === "win32" ? "pocketbase.exe" : "pocketbase",
);
const admin = { email: "bench@example.test", password: "Bench-Passw0rd!" };
const env = {
  ...process.env,
  DUMMY_SALT_SECRET: "bench",
  SYNC_NOW_RATE_LIMIT: "100000",
};
const dir = mkdtempSync(join(tmpdir(), "keiai-bench-"));
const common = ["--dir", dir, "--migrationsDir", join(pbDir, "pb_migrations")];
const PORT = 8199;
const url = `http://127.0.0.1:${PORT}`;

// ---------- realistic payloads ----------
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt"],
);
const ko =
  "그녀는 조용히 창밖을 바라보며 오래된 기억을 떠올렸다 바람이 불어와 커튼이 흔들리고 멀리서 종소리가 들려왔다 당신은 어떻게 생각해 이 마을에 온 지 얼마나 되었지 우리는 그날 밤 숲으로 향했다".split(
    " ",
  );
const en =
  "She smiled softly and leaned closer the candle flickered as the rain kept falling outside you know I have been waiting for this moment for a long time what do you want to do next".split(
    " ",
  );
function text(chars, rnd) {
  let s = "";
  while (s.length < chars) {
    const vocab = rnd() < 0.6 ? ko : en;
    s += vocab[Math.floor(rnd() * vocab.length)] + (rnd() < 0.08 ? ". " : " ");
  }
  return s.slice(0, chars);
}
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const id15 = (n, p) => (p + n.toString(36)).padStart(15, "0").slice(-15);

async function encode(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      deflateRawSync(Buffer.from(JSON.stringify(obj))),
    ),
  );
  return {
    data: Buffer.from(ct).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}
function messageBody(i) {
  const assistant = i % 2 === 1;
  const len = assistant ? 1200 : 150;
  const swipeId = "sw" + i.toString(36);
  return {
    chatId: id15(Math.floor(i / 300), "c"),
    sortOrder: "a" + i.toString(36),
    activeSwipeId: swipeId,
    data: {
      role: assistant ? "assistant" : "user",
      activeSwipeId: swipeId,
      swipes: {
        [swipeId]: {
          id: swipeId,
          createdAt: 1760000000000 + i,
          parts: [{ type: "text", text: text(len, rnd) }],
        },
      },
    },
  };
}
const tombstoneBody = (i) => ({
  chatId: id15(Math.floor(i / 300), "c"),
  sortOrder: "a" + i.toString(36),
  data: {},
});

// Sample payload sizes.
const liveSamples = await Promise.all(
  Array.from({ length: 200 }, (_, i) => encode(messageBody(i))),
);
const tombSample = await encode(tombstoneBody(1));
const avgLive =
  liveSamples.reduce((s, p) => s + p.data.length, 0) / liveSamples.length;
console.log(
  JSON.stringify({
    payload: {
      tombstoneEncryptedChars: tombSample.data.length,
      liveEncryptedCharsAvg: Math.round(avgLive),
    },
  }),
);

// ---------- server ----------
spawnSync(
  binary,
  ["superuser", "upsert", admin.email, admin.password, ...common],
  { env, stdio: "ignore" },
);
const child = spawn(
  binary,
  [
    "serve",
    ...common,
    "--hooksDir",
    join(pbDir, "pb_hooks"),
    "--http",
    `127.0.0.1:${PORT}`,
  ],
  { env, stdio: "ignore" },
);
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("pb did not start");
}
async function api(path, opts = {}, token) {
  const res = await fetch(url + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: token } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path} ${body}`);
  return { json: JSON.parse(body), bytes: Buffer.byteLength(body) };
}

try {
  await waitUp();
  const userId = "benchuser000001";
  const password = "Passw0rd!123456";
  await api("/api/collections/users/records", {
    method: "POST",
    body: JSON.stringify({
      id: userId,
      username: "benchuser",
      password,
      passwordConfirm: password,
      encryptedProfile: "p",
      encryptedProfileIV: "i",
    }),
  });
  const auth = (
    await api("/api/collections/users/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: "benchuser", password }),
    })
  ).json.token;

  const db = new DatabaseSync(join(dir, "data.db"));
  db.exec("PRAGMA busy_timeout = 10000");
  const pageSize = () => db.prepare("PRAGMA page_size").get().page_size;
  const usedBytes = () => {
    const pc = db.prepare("PRAGMA page_count").get().page_count;
    const fl = db.prepare("PRAGMA freelist_count").get().freelist_count;
    return (pc - fl) * pageSize();
  };
  const insert = db.prepare(
    `INSERT INTO records (id, userId, kind, createdAt, updatedAt, encryptedData, encryptedDataIV, isDeleted, tombstoneAt, lineage, assetEntries)
         VALUES (?, ?, 'messages', ?, ?, ?, ?, ?, ?, 'L', '')`,
  );
  let counter = 0;
  async function fill(owner, n, deleted) {
    db.exec("BEGIN");
    for (let i = 0; i < n; i++) {
      const k = counter++;
      const p = deleted ? tombSample : liveSamples[k % liveSamples.length];
      insert.run(
        id15(k, "r"),
        owner,
        1760000000000 + k,
        1760000000000 + k,
        p.data,
        p.iv,
        deleted ? 1 : 0,
        deleted ? 1760000000000 : 0,
      );
    }
    db.exec("COMMIT");
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  // Per-row storage cost, table + all indexes.
  const s0 = usedBytes();
  await fill("sizeprobe000001", 20000, true);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const s1 = usedBytes();
  await fill("sizeprobe000002", 20000, false);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const s2 = usedBytes();
  console.log(
    JSON.stringify({
      serverBytesPerRow: {
        tombstone: Math.round((s1 - s0) / 20000),
        liveMessage: Math.round((s2 - s1) / 20000),
      },
    }),
  );

  // Client-side (Tauri SQLite) per-row cost with the same columns.
  const cdb = new DatabaseSync(":memory:");
  cdb.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, scopeType TEXT, scopeId TEXT, roomId TEXT, chatId TEXT, sortOrder TEXT, activeSwipeId TEXT, createdAt INTEGER, updatedAt INTEGER, localUpdatedAt INTEGER, isDeleted INTEGER, assetEntries TEXT, data TEXT, tombstoneAt INTEGER);
      CREATE INDEX m1 ON messages(scopeType, scopeId, localUpdatedAt); CREATE INDEX m2 ON messages(chatId, sortOrder);`);
  const cUsed = () =>
    cdb.prepare("PRAGMA page_count").get().page_count *
    cdb.prepare("PRAGMA page_size").get().page_size;
  const cIns = cdb.prepare(
    "INSERT INTO messages VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
  );
  const c0 = cUsed();
  cdb.exec("BEGIN");
  for (let i = 0; i < 20000; i++)
    cIns.run(
      id15(i, "t"),
      "user",
      userId,
      id15(i >> 8, "c"),
      "a" + i.toString(36),
      "",
      1,
      2,
      i,
      1,
      "{}",
      3,
    );
  cdb.exec("COMMIT");
  const c1 = cUsed();
  cdb.exec("BEGIN");
  for (let i = 0; i < 20000; i++)
    cIns.run(
      id15(i, "l"),
      "user",
      userId,
      id15(i >> 8, "c"),
      "a" + i.toString(36),
      "sw",
      1,
      2,
      i,
      0,
      JSON.stringify(messageBody(i).data),
      0,
    );
  cdb.exec("COMMIT");
  const c2 = cUsed();
  console.log(
    JSON.stringify({
      clientBytesPerRow: {
        tombstone: Math.round((c1 - c0) / 20000),
        liveMessage: Math.round((c2 - c1) / 20000),
      },
    }),
  );

  // Background: other users' rows on the same server.
  const background = Number(process.env.BENCH_BACKGROUND || 1000000);
  for (let u = 0; u < 100; u++)
    await fill(id15(u, "bg"), background / 100, u % 3 !== 0);

  async function measure(label) {
    // Handshake (includes the hasRecords probe).
    const h0 = performance.now();
    for (let i = 0; i < 20; i++) {
      await api(
        "/api/sync/handshake",
        {
          method: "POST",
          body: JSON.stringify({
            scopeType: "user",
            scopeId: userId,
            pullCursor: 0,
            checkpoints: [],
          }),
        },
        auth,
      );
    }
    const handshakeMs = (performance.now() - h0) / 20;
    // One incremental Pull page (a normal sync with a recent cursor).
    const now = (await api("/api/now", {}, auth)).json.now;
    const filter = (after) =>
      encodeURIComponent(
        `userId = '${userId}' && serverUpdatedAt > ${after} && serverUpdatedAt <= ${now}`,
      );
    const p0 = performance.now();
    for (let i = 0; i < 20; i++) {
      await api(
        `/api/collections/records/records?page=1&perPage=200&skipTotal=1&sort=serverUpdatedAt,id&filter=${filter(now - 50)}`,
        {},
        auth,
      );
    }
    const incrementalMs = (performance.now() - p0) / 20;
    // Full Pull from zero, as a new device or an adoption does.
    let after = 0,
      rows = 0,
      bytes = 0,
      tomb = 0;
    const f0 = performance.now();
    while (true) {
      const { json, bytes: b } = await api(
        `/api/collections/records/records?page=1&perPage=200&skipTotal=1&sort=serverUpdatedAt,id&filter=${filter(after)}`,
        {},
        auth,
      );
      rows += json.items.length;
      bytes += b;
      tomb += json.items.filter((r) => r.isDeleted).length;
      if (json.items.length < 200) break;
      after = json.items[json.items.length - 1].serverUpdatedAt;
    }
    const fullMs = performance.now() - f0;
    console.log(
      JSON.stringify({
        label,
        handshakeMs: +handshakeMs.toFixed(1),
        incrementalPageMs: +incrementalMs.toFixed(1),
        fullPull: {
          rows,
          tombstones: tomb,
          seconds: +(fullMs / 1000).toFixed(1),
          MB: +(bytes / 1e6).toFixed(1),
        },
      }),
    );
  }

  // The user's history grows: live messages stay, tombstones pile up.
  await fill(userId, 20000, false);
  await measure("user: 20k live, 0 tombstones");
  for (const target of [50000, 200000, 500000]) {
    const have = db
      .prepare(
        "SELECT COUNT(*) AS n FROM records WHERE userId = ? AND isDeleted = 1",
      )
      .get(userId).n;
    await fill(userId, target - have, true);
    await measure(`user: 20k live, ${target / 1000}k tombstones`);
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  console.log(
    JSON.stringify({
      dbFileMB: +(statSync(join(dir, "data.db")).size / 1e6).toFixed(0),
      totalRows: db.prepare("SELECT COUNT(*) AS n FROM records").get().n,
    }),
  );
  db.close();
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
