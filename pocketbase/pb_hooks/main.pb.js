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
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    var i, l = bytes.length;
    for (i = 0; i < l; i += 3) {
      var a = bytes[i] & 255;
      var b = (i + 1 < l) ? (bytes[i + 1] & 255) : 0;
      var c = (i + 2 < l) ? (bytes[i + 2] & 255) : 0;
      
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
      return $app.findFirstRecordByData("assetCatalog", "hash", hash);
    } catch (_) {
      return null;
    }
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

// ─── 4. Asset Upload ───────────────────────────────────────────────

routerAdd("POST", "/api/assets/upload", (e) => {
  var getAuthRecord = $app.store().get("getAuthRecord");
  var getNumberField = $app.store().get("getNumberField");
  var getAssetCatalogRecord = $app.store().get("getAssetCatalogRecord");
  
  var auth = getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });

  try {
    var hash = e.request.formValue("hash") || "";
    var kind = e.request.formValue("kind") || "private";
    var size = Number(e.request.formValue("size") || 0);
    var file = e.request.formFile("file");

    if (!hash || !size || size <= 0) {
      return e.json(400, { error: "Invalid upload payload." });
    }

    var user = $app.findRecordById("users", auth.id);
    var assetQuota = getNumberField(
      user,
      "assetQuota",
      DEFAULT_ASSET_QUOTA_BYTES,
    );
    var assetUsage = getNumberField(user, "assetUsage", 0);

    var existing = getAssetCatalogRecord(hash);
    if (existing) {
      var ownerId = existing.getString("ownerId") || "";
      if (existing.getString("kind") === "public") {
        return e.json(200, { status: "public_available", hash: hash });
      }
      if (ownerId === auth.id) {
        // Owner is uploading/importing the same asset again, increment refCount
        existing.set("refCount", getNumberField(existing, "refCount", 1) + 1);
        $app.save(existing);
        return e.json(200, { status: "ref_count_increased", hash: hash });
      }
      // Freerider (different user) - asset already exists on server, skip physical upload and quota
      return e.json(200, { status: "freeride_ok", hash: hash });
    }

    // First timer: Check Quota
    if (assetUsage + size > assetQuota) {
      return e.json(402, { error: "Asset quota exceeded." });
    }

    if (!file) {
      return e.json(400, { error: "Missing file binary." });
    }

    var collection = $app.findCollectionByNameOrId("assetCatalog");
    $app.runInTransaction(function (txApp) {
      var txCollection = txApp.findCollectionByNameOrId("assetCatalog");
      var txRecord = new Record(txCollection);
      txRecord.set("hash", hash);
      txRecord.set("ownerId", auth.id);
      txRecord.set("kind", kind);
      txRecord.set("size", size);
      txRecord.set("refCount", 1);
      txRecord.set("file", file);
      txApp.save(txRecord);

      var txUser = txApp.findRecordById("users", auth.id);
      var txAssetUsage = getNumberField(txUser, "assetUsage", 0);
      txUser.set("assetUsage", txAssetUsage + size);
      txApp.save(txUser);
    });

    return e.json(200, { status: "uploaded", hash: hash });
  } catch (err) {
    return e.json(500, { error: "Upload failed: " + err.toString() });
  }
});

// ─── 5. Asset Deletion ──────────────────────────────────────────────

routerAdd("DELETE", "/api/assets/{hash}", (e) => {
  var getAuthRecord = $app.store().get("getAuthRecord");
  var getNumberField = $app.store().get("getNumberField");
  var getAssetCatalogRecord = $app.store().get("getAssetCatalogRecord");

  var auth = getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });

  var hash = e.request.pathValue("hash");
  var record = getAssetCatalogRecord(hash);
  if (!record) return e.json(200, { deleted: false, noOp: true });

  if (record.getString("ownerId") !== auth.id) {
    // Not the owner, can't delete the server file or affect quota
    return e.json(200, { deleted: false, noOp: true });
  }

  if (record.getString("kind") === "public") {
    return e.json(403, { error: "Public assets cannot be deleted." });
  }

  var user = $app.findRecordById("users", auth.id);
  var assetUsage = getNumberField(user, "assetUsage", 0);
  var size = getNumberField(record, "size", 0);
  var refCount = getNumberField(record, "refCount", 1);

  if (refCount > 1) {
    // Still used in other contexts (e.g. other bots)
    record.set("refCount", refCount - 1);
    $app.save(record);
    return e.json(200, {
      deleted: false,
      status: "ref_count_decreased",
      hash: hash,
    });
  } else {
    // Last reference: actual hard delete and refund quota
    $app.runInTransaction(function (txApp) {
      var txUser = txApp.findRecordById("users", auth.id);
      var txRecord = txApp.findFirstRecordByData("assetCatalog", "hash", hash);
      var txAssetUsage = getNumberField(txUser, "assetUsage", 0);
      var txSize = getNumberField(txRecord, "size", 0);

      txUser.set("assetUsage", Math.max(txAssetUsage - txSize, 0));
      txApp.save(txUser);
      txApp.delete(txRecord);
    });
    return e.json(200, { deleted: true, status: "deleted", hash: hash });
  }
});

// ─── 6. Asset Promotion ─────────────────────────────────────────────

routerAdd("PUT", "/api/assets/promote/{hash}", (e) => {
  var getAuthRecord = $app.store().get("getAuthRecord");
  var getNumberField = $app.store().get("getNumberField");
  var getAssetCatalogRecord = $app.store().get("getAssetCatalogRecord");

  var auth = getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });

  var hash = e.request.pathValue("hash");
  var file = e.request.formFile("file"); // Expecting the decrypted plain image

  var record = getAssetCatalogRecord(hash);
  if (!record) return e.json(404, { error: "Asset not found." });

  if (record.getString("ownerId") !== auth.id) {
    return e.json(403, { error: "Ownership mismatch." });
  }

  if (record.getString("kind") === "public") {
    return e.json(200, { status: "already_public", hash: hash });
  }

  if (!file) {
    return e.json(400, { error: "Missing plain file for promotion." });
  }

  var user = $app.findRecordById("users", auth.id);
  var assetUsage = getNumberField(user, "assetUsage", 0);
  var size = getNumberField(record, "size", 0);

  // Promote to public: Overwrite with plain file and refund quota
  $app.runInTransaction(function (txApp) {
    var txRecord = txApp.findFirstRecordByData("assetCatalog", "hash", hash);
    var txUser = txApp.findRecordById("users", auth.id);
    var txAssetUsage = getNumberField(txUser, "assetUsage", 0);
    var txSize = getNumberField(txRecord, "size", 0);

    txRecord.set("kind", "public");
    txRecord.set("file", file);
    txApp.save(txRecord);

    txUser.set("assetUsage", Math.max(txAssetUsage - txSize, 0));
    txApp.save(txUser);
  });

  return e.json(200, { status: "promoted", hash: hash });
});
