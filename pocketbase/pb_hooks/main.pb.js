/// <reference path="../pb_data/types.d.ts" />

/**
 * KeiAI E2EE Backend Hooks
 *
 * Custom endpoints for the E2EE authentication dance.
 * The client needs the user's salt and recovery bundle before password auth.
 */

// We attach our shared functions and state to the global $app.store()
// so that router callbacks (which run in isolated contexts) can access them.

if (!$app.store().has("checkRate")) {
  var rateBuckets = {};
  var requestCounter = 0;

  $app.store().set("checkRate", function (key, maxRequests, windowMs) {
    var now = Date.now();

    if (++requestCounter > 100) {
      requestCounter = 0;
      var maxWindowMs = 300000;
      for (var k in rateBuckets) {
        rateBuckets[k] = rateBuckets[k].filter(function (t) {
          return t > now - maxWindowMs;
        });
        if (rateBuckets[k].length === 0) {
          delete rateBuckets[k];
        }
      }
    }

    if (!rateBuckets[key]) rateBuckets[key] = [];
    rateBuckets[key] = rateBuckets[key].filter(function (t) {
      return t > now - windowMs;
    });

    if (rateBuckets[key].length >= maxRequests) {
      return false;
    }

    rateBuckets[key].push(now);
    return true;
  });

  $app.store().set("constantTimeEqual", function (a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  });

  $app.store().set("hexToBytes", function (hex, byteCount) {
    var bytes = [];
    for (var i = 0; i < hex.length && bytes.length < byteCount; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return bytes;
  });

  $app.store().set("bytesToBase64", function (bytes) {
    var chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    var i,
      l = bytes.length;
    for (i = 0; i < l; i += 3) {
      var a = bytes[i] & 255;
      var b = i + 1 < l ? bytes[i + 1] & 255 : 0;
      var c = i + 2 < l ? bytes[i + 2] & 255 : 0;

      result += chars[a >> 2];
      result += chars[((a & 3) << 4) | (b >> 4)];
      if (i + 1 < l) result += chars[((b & 15) << 2) | (c >> 6)];
      else result += "=";
      if (i + 2 < l) result += chars[c & 63];
      else result += "=";
    }
    return result;
  });

  $app.store().set("dummySaltForUsername", function (username) {
    var DUMMY_SALT_SECRET = $os.getenv("DUMMY_SALT_SECRET");
    var normalized = String(username || "")
      .trim()
      .toLowerCase();
    var digest = $security.sha256(DUMMY_SALT_SECRET + ":" + normalized);
    var hexToBytes = $app.store().get("hexToBytes");
    var bytesToBase64 = $app.store().get("bytesToBase64");

    var bytes = /^[0-9a-f]+$/i.test(digest)
      ? hexToBytes(digest, 16)
      : Array.from(String(digest).slice(0, 16)).map(function (ch) {
          return ch.charCodeAt(0) & 255;
        });
    return bytesToBase64(bytes);
  });

  $app.store().set("getAuthRecord", function (e) {
    try {
      if (e.auth && e.auth.id) return e.auth;
    } catch (_) {}
    try {
      var requestInfo = e.requestInfo();
      if (requestInfo && requestInfo.auth && requestInfo.auth.id) {
        return requestInfo.auth;
      }
    } catch (_) {}
    return null;
  });

  $app.store().set("getNumberField", function (record, fieldName, fallback) {
    try {
      var rawValue = record.get(fieldName);
      if (rawValue === null || rawValue === "") return fallback;
      var parsed = Number(rawValue);
      if (!isNaN(parsed)) return parsed;
    } catch (_) {}
    return fallback;
  });

  $app.store().set("getAssetCatalogRecord", function (hash) {
    try {
      return $app.findFirstRecordByData("asset_catalog", "hash", hash);
    } catch (_) {
      return null;
    }
  });

  $app.store().set("sha256Bytes", function (bytes) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }

    var k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    var h = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ];

    var msg = bytes.slice();
    var bitLength = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var high = Math.floor(bitLength / 0x100000000);
    var low = bitLength >>> 0;
    msg.push(
      (high >>> 24) & 255,
      (high >>> 16) & 255,
      (high >>> 8) & 255,
      high & 255,
    );
    msg.push(
      (low >>> 24) & 255,
      (low >>> 16) & 255,
      (low >>> 8) & 255,
      low & 255,
    );

    for (var offset = 0; offset < msg.length; offset += 64) {
      var w = new Array(64);
      for (var i = 0; i < 16; i++) {
        var j = offset + i * 4;
        w[i] =
          (((msg[j] & 255) << 24) |
            ((msg[j + 1] & 255) << 16) |
            ((msg[j + 2] & 255) << 8) |
            (msg[j + 3] & 255)) >>>
          0;
      }
      for (var t = 16; t < 64; t++) {
        var s0 =
          rightRotate(w[t - 15], 7) ^
          rightRotate(w[t - 15], 18) ^
          (w[t - 15] >>> 3);
        var s1 =
          rightRotate(w[t - 2], 17) ^
          rightRotate(w[t - 2], 19) ^
          (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }

      var a = h[0],
        b = h[1],
        c = h[2],
        d = h[3];
      var e = h[4],
        f = h[5],
        g = h[6],
        hh = h[7];
      for (var round = 0; round < 64; round++) {
        var s1r = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (hh + s1r + ch + k[round] + w[round]) >>> 0;
        var s0r = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (s0r + maj) >>> 0;
        hh = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0;
      h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0;
      h[7] = (h[7] + hh) >>> 0;
    }

    return h
      .map(function (n) {
        return ("00000000" + n.toString(16)).slice(-8);
      })
      .join("");
  });

  $app.store().set("findRecoveryRecord", function (e, rateKey, maxRequests) {
    var checkRate = $app.store().get("checkRate");
    var constantTimeEqual = $app.store().get("constantTimeEqual");
    var ip = e.realIP();
    if (!checkRate(ip + ":" + rateKey, maxRequests, 60000)) {
      return {
        error: e.json(429, { error: "Too many requests. Try again later." }),
      };
    }
    var body = e.requestInfo().body || {};
    var authTokenHash = body.authTokenHash || "";
    if (!authTokenHash) {
      return { error: e.json(400, { error: "Missing auth token." }) };
    }
    var record;
    try {
      record = $app.findFirstRecordByData(
        "users",
        "recoveryAuthTokenHash",
        authTokenHash,
      );
    } catch (_) {
      return { error: e.json(401, { error: "Recovery failed." }) };
    }
    var storedHash = record.getString("recoveryAuthTokenHash");
    if (!constantTimeEqual(storedHash, authTokenHash)) {
      return { error: e.json(401, { error: "Recovery failed." }) };
    }
    return { record: record, body: body };
  });
}

if (!$app.store().has("pairingBlobs")) {
  $app.store().set("pairingBlobs", {});
}

// ─── Configuration ───────────────────────────────────────────────────

var DUMMY_SALT_SECRET = $os.getenv("DUMMY_SALT_SECRET");
var DEFAULT_ASSET_QUOTA_BYTES = Number(
  $os.getenv("DEFAULT_ASSET_QUOTA_BYTES") || Infinity,
);

if (!DUMMY_SALT_SECRET) {
  throw new Error("DUMMY_SALT_SECRET is not defined");
}

// ─── 0. Server Capabilities ─────────────────────────────────────────

routerAdd("GET", "/api/capabilities", (e) => {
  var checkRate = $app.store().get("checkRate");
  var ip = e.realIP();
  if (checkRate && !checkRate(ip + ":capabilities", 60, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  return e.json(200, {
    app: "keiai",
    protocol: 1,
  });
});

// ─── 1. Username Salt Lookup ─────────────────────────────────────────

routerAdd("POST", "/api/account/salt", (e) => {
  try {
    var checkRate = $app.store().get("checkRate");
    var ip = e.realIP();
    if (checkRate && !checkRate(ip + ":account-salt", 20, 60000)) {
      return e.json(429, { error: "Too many requests. Try again later." });
    }

    var body = e.requestInfo().body || {};
    var username = body.username || "";
    if (!username) return e.json(400, { error: "Missing username." });

    var dummySaltForUsername = $app.store().get("dummySaltForUsername");
    var dummySalt = dummySaltForUsername(username);
    var realSalt = "";

    try {
      var user = $app.findFirstRecordByData("users", "username", username);
      if (user) {
        realSalt = user.getString("salt");
      }
    } catch (_) {
      realSalt = "";
    }

    return e.json(200, { salt: realSalt || dummySalt });
  } catch (err) {
    return e.json(500, { error: "Internal server error." });
  }
});

// ─── 2. Recovery ────────────────────────────────────────────────────

routerAdd("POST", "/api/recovery/lookup", (e) => {
  var findRecoveryRecord = $app.store().get("findRecoveryRecord");
  var result = findRecoveryRecord(e, "recovery-lookup", 5);
  if (result.error) return result.error;
  var record = result.record;

  return e.json(200, {
    userId: record.id,
    username: record.getString("username"),
    name: record.getString("name"),
    email: record.getString("email"),
    avatar: record.getString("avatar"),
    encryptedRecoveryMasterKey: record.getString("encryptedRecoveryMasterKey"),
    encryptedRecoveryMasterKeyIV: record.getString("recoveryMasterKeyIv"),
    identityPublicKey: record.getString("identityPublicKey"),
    encryptedIdentityPrivateKey: record.getString(
      "encryptedIdentityPrivateKey",
    ),
    identityPrivateKeyIv: record.getString("identityPrivateKeyIv"),
  });
});

routerAdd("POST", "/api/recovery/reset-password", (e) => {
  var findRecoveryRecord = $app.store().get("findRecoveryRecord");
  var result = findRecoveryRecord(e, "recovery-reset", 5);
  if (result.error) return result.error;
  var record = result.record;
  var body = result.body;

  record.setPassword(body.newPassword);
  record.set("salt", body.salt);
  record.set("encryptedMasterKey", body.encryptedMasterKey);
  record.set("masterKeyIv", body.masterKeyIv);
  record.set("encryptedRecoveryMasterKey", body.encryptedRecoveryMasterKey);
  record.set("recoveryMasterKeyIv", body.recoveryMasterKeyIv);
  record.set("recoveryAuthTokenHash", body.recoveryAuthTokenHash);

  $app.save(record);
  return e.json(200, { success: true });
});

routerAdd("POST", "/api/recovery/delete", (e) => {
  var findRecoveryRecord = $app.store().get("findRecoveryRecord");
  var result = findRecoveryRecord(e, "recovery-delete", 3);
  if (result.error) return result.error;

  $app.delete(result.record);
  return e.json(200, { success: true });
});

// ─── 3. Device Pairing ──────────────────────────────────────────────

routerAdd("POST", "/api/pairing", (e) => {
  var checkRate = $app.store().get("checkRate");
  var getAuthRecord = $app.store().get("getAuthRecord");
  var ip = e.realIP();
  if (!checkRate(ip + ":pairing-post", 10, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var auth = getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });

  var body = e.requestInfo().body || {};
  var id = body.id || "";
  var blob = body.blob || "";
  var ttl = Number(body.ttl || 300);
  if (!id || !blob) return e.json(400, { error: "Invalid pairing payload." });

  var pairingBlobs = $app.store().get("pairingBlobs");
  pairingBlobs[id] = {
    blob: blob,
    expiresAt: Date.now() + Math.min(ttl, 300) * 1000,
    attempts: 0,
  };
  $app.store().set("pairingBlobs", pairingBlobs);

  return e.json(200, { success: true });
});

routerAdd("GET", "/api/pairing/{lookupId}", (e) => {
  var checkRate = $app.store().get("checkRate");
  var ip = e.realIP();
  if (!checkRate(ip + ":pairing-get", 20, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var lookupId = e.request.pathValue("lookupId");
  var pairingBlobs = $app.store().get("pairingBlobs");
  var entry = pairingBlobs[lookupId];
  if (!entry || entry.expiresAt < Date.now() || entry.attempts >= 5) {
    delete pairingBlobs[lookupId];
    $app.store().set("pairingBlobs", pairingBlobs);
    return e.json(404, { error: "Pairing not found." });
  }

  entry.attempts += 1;
  delete pairingBlobs[lookupId];
  $app.store().set("pairingBlobs", pairingBlobs);
  return e.json(200, { blob: entry.blob });
});

// ─── 4. Asset API ──────────────────────────────────────────────────

routerAdd("PUT", "/api/assets/{hash}", (e) => {
  var checkRate = $app.store().get("checkRate");
  var getAuthRecord = $app.store().get("getAuthRecord");
  var getNumberField = $app.store().get("getNumberField");
  var getAssetCatalogRecord = $app.store().get("getAssetCatalogRecord");
  var sha256Bytes = $app.store().get("sha256Bytes");

  var ip = e.realIP();
  if (!checkRate(ip + ":asset-upload", 30, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var auth = getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });

  try {
    var hash = e.request.pathValue("hash");
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      return e.json(400, { error: "Invalid asset hash." });
    }
    hash = hash.toLowerCase();

    var existing = getAssetCatalogRecord(hash);
    if (existing) {
      return e.json(200, { status: "exists", hash: hash });
    }

    var body = toBytes(e.request.body, 10 * 1024 * 1024 + 1);
    if (!body || body.length === 0) {
      return e.json(400, { error: "Missing asset ciphertext." });
    }
    if (body.length > 10 * 1024 * 1024) {
      return e.json(413, { error: "Asset too large." });
    }

    var actualHash = sha256Bytes(body);
    if (actualHash !== hash) {
      return e.json(400, { error: "Asset hash mismatch." });
    }

    var created = false;
    $app.runInTransaction(function (txApp) {
      if (findAssetCatalog(txApp, hash)) return;

      var user = txApp.findRecordById("users", auth.id);
      var assetMaxBytes = getNumberField(
        user,
        "assetMaxBytes",
        DEFAULT_ASSET_QUOTA_BYTES,
      );
      var assetUsedBytes = getNumberField(user, "assetUsedBytes", 0);
      if (assetUsedBytes + body.length > assetMaxBytes) {
        throw new Error("QUOTA_EXCEEDED");
      }

      var collection = txApp.findCollectionByNameOrId("asset_catalog");
      var record = new Record(collection);
      record.set("hash", hash);
      record.set("size", body.length);
      record.set("data", $filesystem.fileFromBytes(body, hash + ".bin"));
      txApp.save(record);
      created = true;
    });

    return e.json(created ? 201 : 200, {
      status: created ? "stored" : "exists",
      hash: hash,
    });
  } catch (err) {
    if (err && err.message === "QUOTA_EXCEEDED") {
      return e.json(402, { error: "Asset quota exceeded." });
    }
    return e.json(500, { error: "Upload failed: " + err.toString() });
  }
});

routerAdd("GET", "/api/assets/download/{hash}", (e) => {
  var getAuthRecord = $app.store().get("getAuthRecord");
  var getAssetCatalogRecord = $app.store().get("getAssetCatalogRecord");

  var auth = getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });

  var hash = e.request.pathValue("hash");
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return e.json(400, { error: "Invalid asset hash." });
  }

  var record = getAssetCatalogRecord(hash.toLowerCase());
  if (!record) return e.json(404, { error: "Asset not found." });

  var filename = record.getString("data");
  if (!filename) return e.json(404, { error: "Asset not found." });

  var fsys = $app.newFilesystem();
  try {
    return fsys.serve(
      e.response,
      e.request,
      record.baseFilesPath() + "/" + filename,
      hash.toLowerCase() + ".bin",
    );
  } catch (_) {
    return e.json(404, { error: "Asset file not found." });
  } finally {
    fsys.close();
  }
});

// ─── 5. Asset Usage Hooks ───────────────────────────────────────────

function isLiveAssetRef(record) {
  return Boolean(
    record &&
    record.getString("status") === "remote" &&
    !record.getBool("isDeleted") &&
    record.getString("hash"),
  );
}

function findAssetUsage(app, userId, hash) {
  try {
    return app.findFirstRecordByFilter(
      "asset_usage",
      "userId = {:userId} && hash = {:hash}",
      { userId: userId, hash: hash },
    );
  } catch (_) {
    return null;
  }
}

function findAssetCatalog(app, hash) {
  try {
    return app.findFirstRecordByData("asset_catalog", "hash", hash);
  } catch (_) {
    return null;
  }
}

function incrementUsage(userId, hash) {
  var getNumberField = $app.store().get("getNumberField");
  var now = Date.now();

  $app.runInTransaction(function (txApp) {
    var usage = findAssetUsage(txApp, userId, hash);
    if (usage) {
      usage.set("refCount", getNumberField(usage, "refCount", 0) + 1);
      usage.set("updatedAt", now);
      txApp.save(usage);
      return;
    }

    var catalog = findAssetCatalog(txApp, hash);
    if (!catalog) return;

    var size = getNumberField(catalog, "size", 0);
    if (size <= 0) return;

    var collection = txApp.findCollectionByNameOrId("asset_usage");
    var created = new Record(collection);
    created.set("userId", userId);
    created.set("hash", hash);
    created.set("refCount", 1);
    created.set("size", size);
    created.set("createdAt", now);
    created.set("updatedAt", now);
    txApp.save(created);

    var user = txApp.findRecordById("users", userId);
    var used = getNumberField(user, "assetUsedBytes", 0);
    user.set("assetUsedBytes", used + size);
    txApp.save(user);
  });
}

function decrementUsage(userId, hash) {
  var getNumberField = $app.store().get("getNumberField");
  var now = Date.now();

  $app.runInTransaction(function (txApp) {
    var usage = findAssetUsage(txApp, userId, hash);
    if (!usage) return;

    var refCount = getNumberField(usage, "refCount", 0);
    if (refCount > 1) {
      usage.set("refCount", refCount - 1);
      usage.set("updatedAt", now);
      txApp.save(usage);
      return;
    }

    var size = getNumberField(usage, "size", 0);
    txApp.delete(usage);

    var user = txApp.findRecordById("users", userId);
    var used = getNumberField(user, "assetUsedBytes", 0);
    user.set("assetUsedBytes", Math.max(used - size, 0));
    txApp.save(user);
  });
}

function handleAssetRefTransition(record, oldRecord) {
  var oldLive = isLiveAssetRef(oldRecord);
  var newLive = isLiveAssetRef(record);
  var oldHash = oldLive ? oldRecord.getString("hash").toLowerCase() : "";
  var newHash = newLive ? record.getString("hash").toLowerCase() : "";

  if (oldLive === newLive && oldHash === newHash) return;

  var userId = record.getString("userId");
  if (oldLive && (!newLive || oldHash !== newHash)) {
    decrementUsage(userId, oldHash);
  }
  if (newLive && (!oldLive || oldHash !== newHash)) {
    incrementUsage(userId, newHash);
  }
}

onRecordAfterCreateSuccess((e) => {
  handleAssetRefTransition(e.record, null);
}, "assets");

onRecordAfterUpdateSuccess((e) => {
  handleAssetRefTransition(e.record, e.record.original());
}, "assets");

// ─── 6. Asset Garbage Collection ────────────────────────────────────

cronAdd("asset-gc", "0 * * * *", () => {
  var pageSize = 200;
  var offset = 0;

  while (true) {
    var records = $app.findRecordsByFilter(
      "asset_catalog",
      "",
      "",
      pageSize,
      offset,
    );
    if (!records || records.length === 0) break;

    var deletedInThisPage = 0;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record) continue;
      try {
        $app.findFirstRecordByData(
          "asset_usage",
          "hash",
          record.getString("hash"),
        );
      } catch (_) {
        try {
          $app.delete(record);
          deletedInThisPage++;
        } catch (_) {}
      }
    }

    if (records.length < pageSize) break;
    if (deletedInThisPage === 0) offset += pageSize;
  }
});
