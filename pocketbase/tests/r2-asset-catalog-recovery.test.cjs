const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");

const hookPath = require.resolve("../pb_hooks/keiai.js");
const validHash = "a".repeat(64);
const existingHash = "b".repeat(64);

class MockRecord {
  constructor() {
    this.fields = {};
  }

  set(name, value) {
    this.fields[name] = value;
  }

  get(name) {
    return this.fields[name];
  }
}

function installGlobals(env, objects, initialCatalog = []) {
  const catalog = new Map(initialCatalog.map((record) => [record.hash, record]));
  let filesystemClosed = false;

  global.Record = MockRecord;
  global.$os = {
    getenv(name) {
      return env[name] ?? "";
    },
  };
  global.$filesystem = {
    s3() {
      return {
        list(prefix) {
          assert.equal(prefix, "assets/");
          return objects;
        },
        close() {
          filesystemClosed = true;
        },
      };
    },
  };
  global.$app = {
    findCollectionByNameOrId(name) {
      assert.equal(name, "asset_catalog");
      return { name };
    },
    findFirstRecordByData(collection, field, value) {
      assert.equal(collection, "asset_catalog");
      assert.equal(field, "hash");
      const record = catalog.get(value);
      if (!record) throw new Error("not found");
      return record;
    },
    findRecordsByFilter() {
      return [];
    },
    runInTransaction(callback) {
      callback(this);
    },
    save(record) {
      catalog.set(record.fields.hash, record);
    },
  };

  return {
    catalog,
    isFilesystemClosed: () => filesystemClosed,
  };
}

beforeEach(() => {
  delete require.cache[hookPath];
});

afterEach(() => {
  delete global.Record;
  delete global.$app;
  delete global.$filesystem;
  delete global.$os;
});

test("skips recovery when R2 is not fully configured", () => {
  const state = installGlobals({}, []);
  const { recoverR2AssetCatalog } = require(hookPath);

  assert.deepEqual(recoverR2AssetCatalog(), {
    configured: false,
    scanned: 0,
    recovered: 0,
    existing: 0,
    skipped: 0,
    failed: 0,
  });
  assert.equal(state.isFilesystemClosed(), false);
});

test("restores missing catalog rows from valid R2 asset objects", () => {
  const env = {
    R2_BUCKET: "bucket",
    R2_ENDPOINT: "https://r2.example.com",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
  };
  const state = installGlobals(
    env,
    [
      { key: `assets/${validHash}.bin`, size: 123, isDir: false },
      { key: `assets/${existingHash}.bin`, size: 456, isDir: false },
      { key: "assets/not-an-asset.txt", size: 1, isDir: false },
      { key: `assets/${"c".repeat(64)}.bin`, size: 0, isDir: false },
      { key: "assets/nested/", size: 0, isDir: true },
    ],
    [{ hash: existingHash, size: 456 }],
  );
  const { recoverR2AssetCatalog } = require(hookPath);

  const result = recoverR2AssetCatalog();

  assert.deepEqual(result, {
    configured: true,
    scanned: 5,
    recovered: 1,
    existing: 1,
    skipped: 3,
    failed: 0,
  });
  assert.equal(state.catalog.get(validHash).fields.size, 123);
  assert.equal(state.catalog.has(existingHash), true);
  assert.equal(state.isFilesystemClosed(), true);
});
