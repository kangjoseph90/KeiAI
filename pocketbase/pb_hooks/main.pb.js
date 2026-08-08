/// <reference path="../pb_data/types.d.ts" />

/**
 * KeiAI E2EE Backend Hooks
 *
 * Custom endpoints for the E2EE authentication dance.
 * The client needs the user's salt and recovery bundle before password auth.
 */

// Configuration

var DUMMY_SALT_SECRET = $os.getenv("DUMMY_SALT_SECRET");
if (!DUMMY_SALT_SECRET) {
  throw new Error("DUMMY_SALT_SECRET is not defined");
}

var PAIRING_TTL_SECONDS = 300;
var PAIRING_BLOB_MAX_CHARS = 65536;

// Restore catalog rows for durable R2 objects after migrations have completed.

$app.onServe().bindFunc((e) => {
  try {
    var result = require(`${__hooks}/keiai.js`).recoverR2AssetCatalog();
    if (result.configured) {
      $app
        .logger()
        .info(
          "R2 asset catalog recovery completed.",
          "scanned",
          result.scanned,
          "recovered",
          result.recovered,
          "existing",
          result.existing,
          "skipped",
          result.skipped,
          "failed",
          result.failed,
        );
    }
  } catch (err) {
    $app.logger().error("R2 asset catalog recovery failed.", "error", err);
  }
  e.next();
});

// Username whitelist

onRecordCreateRequest((e) => {
  var h = require(`${__hooks}/keiai.js`);
  if (e.record) {
    h.rejectDisallowedUsername(e, e.record.getString("username"));
  }
  e.next();
}, "users");

onRecordUpdateRequest((e) => {
  var h = require(`${__hooks}/keiai.js`);
  if (e.record) {
    h.rejectDisallowedUsername(e, e.record.getString("username"));
  }
  e.next();
}, "users");

onRecordAuthRequest((e) => {
  var h = require(`${__hooks}/keiai.js`);
  if (e.record) {
    h.rejectDisallowedUsername(e, e.record.getString("username"));
  }
  e.next();
}, "users");

onRecordAuthRefreshRequest((e) => {
  var h = require(`${__hooks}/keiai.js`);
  if (e.record) {
    h.rejectDisallowedUsername(e, e.record.getString("username"));
  }
  e.next();
}, "users");

onRecordsListRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onRecordViewRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onRecordCreateRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onRecordUpdateRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onRecordDeleteRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onBatchRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onFileDownloadRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onFileTokenRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onRealtimeConnectRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

onRealtimeSubscribeRequest((e) => {
  require(`${__hooks}/keiai.js`).rejectDisallowedAuth(e);
  e.next();
});

// Canonical sync arbitration. Record hooks run for both HTTP requests and
// programmatic $app.save calls (including the custom endpoint transactions).
// Never trust a client supplied serverUpdatedAt value.
var syncCollections = [
  "records",
  "multi_room_records",
  "multi_room_index",
  "multi_room_members",
];

syncCollections.forEach((collectionName) => {
  onRecordCreate((e) => {
    if (e.record) {
      var h = require(`${__hooks}/keiai.js`);
      h.stampSyncRecordCreate(e.record);
    }
    e.next();
  }, collectionName);

  onRecordUpdate((e) => {
    if (e.record) {
      require(`${__hooks}/keiai.js`).applySyncRecordUpdate(
        e.record,
        collectionName,
      );
    }
    e.next();
  }, collectionName);
});

// A room-index tombstone must go through the owner deletion endpoint so the
// related room records are removed in the same server transaction. These
// request hooks do not affect that endpoint's programmatic $app.save call.
onRecordCreateRequest((e) => {
  if (e.record.getBool("isDeleted")) e.record.set("isDeleted", false);
  e.next();
}, "multi_room_index");

onRecordUpdateRequest((e) => {
  var existing = $app.findRecordById("multi_room_index", e.record.id);
  if (
    existing &&
    !existing.getBool("isDeleted") &&
    e.record.getBool("isDeleted")
  ) {
    e.record.set("isDeleted", false);
  }
  e.next();
}, "multi_room_index");

// Server spec

routerAdd("GET", "/api/spec", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var ip = e.realIP();
  if (!h.checkRate(ip + ":spec", 60, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  return e.json(200, {
    app: "keiai",
    protocol: 1,
  });
});

// Server clock upper bound for bounded remote pulls.
routerAdd("GET", "/api/now", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var timestamp = h.getServerTimestamp();
  return e.json(200, { now: timestamp });
});

// Username salt lookup

routerAdd("POST", "/api/account/salt", (e) => {
  try {
    var h = require(`${__hooks}/keiai.js`);
    var ip = e.realIP();
    if (!h.checkRate(ip + ":account-salt", 20, 60000)) {
      return e.json(429, { error: "Too many requests. Try again later." });
    }

    var body = e.requestInfo().body || {};
    var username = h.normalizeUsername(body.username);
    if (!username) return e.json(400, { error: "Missing username." });

    var dummySalt = h.dummySaltForUsername(username);
    if (!h.isUsernameAllowed(username)) {
      return e.json(200, { salt: dummySalt });
    }

    var realSalt = "";

    try {
      var user = $app.findFirstRecordByData("users", "username", username);
      if (user) {
        realSalt = user.getString("salt");
      }
    } catch (err) {
      if (!h.isNoRowsError(err)) throw err;
      realSalt = "";
    }

    return e.json(200, { salt: realSalt || dummySalt });
  } catch (err) {
    return e.json(500, { error: "Internal server error." });
  }
});

// Recovery

routerAdd("POST", "/api/recovery/lookup", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var result = h.findRecoveryRecord(e, "recovery-lookup", 5);
  if (result.error) return result.error;
  var record = result.record;

  return e.json(200, {
    userId: record.id,
    username: record.getString("username"),
    email: record.getString("email"),
    encryptedRecoveryMasterKey: record.getString("encryptedRecoveryMasterKey"),
    encryptedRecoveryMasterKeyIV: record.getString("recoveryMasterKeyIv"),
    identityPublicKey: record.getString("identityPublicKey"),
    encryptedIdentityPrivateKey: record.getString(
      "encryptedIdentityPrivateKey",
    ),
    identityPrivateKeyIv: record.getString("identityPrivateKeyIv"),
    encryptedProfile: record.getString("encryptedProfile"),
    encryptedProfileIV: record.getString("encryptedProfileIV"),
  });
});

routerAdd("POST", "/api/recovery/reset-password", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var result = h.findRecoveryRecord(e, "recovery-reset", 5);
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
  var h = require(`${__hooks}/keiai.js`);
  var result = h.findRecoveryRecord(e, "recovery-delete", 3);
  if (result.error) return result.error;

  h.deleteUserCascade(result.record);
  return e.json(200, { success: true });
});

// Device pairing

routerAdd("POST", "/api/pairing", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var ip = e.realIP();
  if (!h.checkRate(ip + ":pairing-post", 10, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var body = e.requestInfo().body || {};
  var id = String(body.id || "");
  var blob = String(body.blob || "");
  var ttl =
    body.ttl == null || body.ttl === ""
      ? PAIRING_TTL_SECONDS
      : Number(body.ttl);
  if (
    !/^[0-9a-f]{64}$/i.test(id) ||
    !blob ||
    blob.length > PAIRING_BLOB_MAX_CHARS ||
    !isFinite(ttl) ||
    ttl <= 0
  ) {
    return e.json(400, { error: "Invalid pairing payload." });
  }
  ttl = Math.min(Math.floor(ttl), PAIRING_TTL_SECONDS);

  var pairingBlobs = h.getPairingBlobs();
  pairingBlobs[id] = {
    blob: blob,
    expiresAt: Date.now() + ttl * 1000,
    attempts: 0,
  };
  h.setPairingBlobs(pairingBlobs);

  return e.json(200, { success: true });
});

routerAdd("GET", "/api/pairing/{lookupId}", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var ip = e.realIP();
  if (!h.checkRate(ip + ":pairing-get", 20, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var lookupId = e.request.pathValue("lookupId");
  if (!/^[0-9a-f]{64}$/i.test(lookupId)) {
    return e.json(404, { error: "Pairing not found." });
  }

  var pairingBlobs = h.getPairingBlobs();
  var entry = pairingBlobs[lookupId];
  if (
    !entry ||
    typeof entry.expiresAt !== "number" ||
    !isFinite(entry.expiresAt) ||
    entry.expiresAt < Date.now() ||
    Number(entry.attempts || 0) >= 5
  ) {
    delete pairingBlobs[lookupId];
    h.setPairingBlobs(pairingBlobs);
    return e.json(404, { error: "Pairing not found." });
  }

  entry.attempts += 1;
  delete pairingBlobs[lookupId];
  h.setPairingBlobs(pairingBlobs);
  return e.json(200, { blob: entry.blob });
});

// Multi-room lifecycle API

routerAdd("GET", "/api/multi-rooms/search", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var ip = e.realIP();
  if (!h.checkRate(ip + ":multi-room-search", 30, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var query = e.requestInfo().query || {};
  return e.json(200, { rooms: h.searchPublicMultiRooms(query.name) });
});

routerAdd("GET", "/api/users/{userId}/public-key", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var ip = e.realIP();
  if (!h.checkRate(ip + ":user-public-key", 60, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var result = h.getUserPublicKey(e.request.pathValue("userId"));
  return e.json(result.status, result.body);
});

routerAdd("POST", "/api/multi-rooms/{roomId}/join-request", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var ip = e.realIP();
  if (!h.checkRate(ip + ":multi-room-join", 10, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var roomId = e.request.pathValue("roomId");
  var result = h.createOrUpdateJoinRequest(auth, roomId);
  return e.json(result.status, result.body);
});

routerAdd("POST", "/api/multi-rooms/{roomId}/leave", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var ip = e.realIP();
  if (!h.checkRate(ip + ":multi-room-leave", 20, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var roomId = e.request.pathValue("roomId");
  var result = h.leaveMultiRoom(auth, roomId);
  return e.json(result.status, result.body);
});

routerAdd("DELETE", "/api/multi-rooms/{roomId}", (e) => {
  var h = require(`${__hooks}/keiai.js`);
  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var ip = e.realIP();
  if (!h.checkRate(ip + ":multi-room-delete", 10, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var roomId = e.request.pathValue("roomId");
  var result = h.deleteMultiRoom(auth, roomId);
  return e.json(result.status, result.body);
});

// Asset API

routerAdd("PUT", "/api/assets/{hash}", (e) => {
  var h = require(`${__hooks}/keiai.js`);

  var ip = e.realIP();
  if (!h.checkRate(ip + ":asset-upload", 300, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  try {
    var hash = e.request.pathValue("hash");
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      return e.json(400, { error: "Invalid asset hash." });
    }
    hash = hash.toLowerCase();

    var body = toBytes(e.request.body, 10 * 1024 * 1024 + 1);
    if (!body || body.length === 0) {
      return e.json(400, { error: "Missing asset ciphertext." });
    }
    if (body.length > 10 * 1024 * 1024) {
      return e.json(413, { error: "Asset too large." });
    }

    var actualHash = h.sha256Bytes(body);
    if (actualHash !== hash) {
      return e.json(400, { error: "Asset hash mismatch." });
    }

    var existing = h.findAssetCatalogWith($app, hash);
    if (existing) {
      var storedExisting = h.storeAssetBytes(hash, body, existing);
      return e.json(storedExisting.status === "stored" ? 201 : 200, {
        status: storedExisting.status,
        hash: hash,
      });
    }

    var created = false;
    $app.runInTransaction(function (txApp) {
      if (h.findAssetCatalogWith(txApp, hash)) return;

      var account = h.getOrCreateAssetAccount(txApp, auth.id);
      var maxBytes = h.getAssetMaxBytes(account);
      var usedBytes = h.getNumberField(account, "usedBytes", 0);
      if (usedBytes + body.length > maxBytes) {
        throw new Error("QUOTA_EXCEEDED");
      }

      var collection = txApp.findCollectionByNameOrId("asset_catalog");
      var record = new Record(collection);
      record.set("hash", hash);
      record.set("size", body.length);
      record.set("createdAt", Date.now());
      var storedAsset = h.storeAssetBytes(hash, body, null);
      if (storedAsset.file) {
        record.set("data", storedAsset.file);
      }
      try {
        txApp.save(record);
        created = true;
      } catch (err) {
        if (!h.findAssetCatalogWith(txApp, hash)) throw err;
      }
    });

    if (created) {
      try {
        h.reconcilePendingAssetUsage(hash);
      } catch (_) {}
    }

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

routerAdd("PUT", "/api/multi-rooms/{roomId}/assets/{hash}", (e) => {
  var h = require(`${__hooks}/keiai.js`);

  var ip = e.realIP();
  if (!h.checkRate(ip + ":multi-room-asset-upload", 300, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  try {
    var roomId = e.request.pathValue("roomId");
    var hash = e.request.pathValue("hash");
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      return e.json(400, { error: "Invalid asset hash." });
    }
    hash = hash.toLowerCase();

    var owner = h.getMultiRoomUploadOwner(auth, roomId);
    if (owner.status !== 200) return e.json(owner.status, owner.body);

    var body = toBytes(e.request.body, 10 * 1024 * 1024 + 1);
    if (!body || body.length === 0) {
      return e.json(400, { error: "Missing asset ciphertext." });
    }
    if (body.length > 10 * 1024 * 1024) {
      return e.json(413, { error: "Asset too large." });
    }

    var actualHash = h.sha256Bytes(body);
    if (actualHash !== hash) {
      return e.json(400, { error: "Asset hash mismatch." });
    }

    var existing = h.findAssetCatalogWith($app, hash);
    if (existing) {
      var storedExisting = h.storeAssetBytes(hash, body, existing);
      return e.json(storedExisting.status === "stored" ? 201 : 200, {
        status: storedExisting.status,
        hash: hash,
      });
    }

    var created = false;
    $app.runInTransaction(function (txApp) {
      if (h.findAssetCatalogWith(txApp, hash)) return;

      var account = h.getOrCreateAssetAccount(txApp, owner.ownerUserId);
      var maxBytes = h.getAssetMaxBytes(account);
      var usedBytes = h.getNumberField(account, "usedBytes", 0);
      if (usedBytes + body.length > maxBytes) {
        throw new Error("QUOTA_EXCEEDED");
      }

      var collection = txApp.findCollectionByNameOrId("asset_catalog");
      var record = new Record(collection);
      record.set("hash", hash);
      record.set("size", body.length);
      record.set("createdAt", Date.now());
      var storedAsset = h.storeAssetBytes(hash, body, null);
      if (storedAsset.file) {
        record.set("data", storedAsset.file);
      }
      try {
        txApp.save(record);
        created = true;
      } catch (err) {
        if (!h.findAssetCatalogWith(txApp, hash)) throw err;
      }
    });

    if (created) {
      try {
        h.reconcilePendingAssetUsage(hash);
      } catch (_) {}
    }

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
  var h = require(`${__hooks}/keiai.js`);

  var auth = h.getAuthRecord(e);
  if (!auth) return e.json(401, { error: "Authentication required." });
  h.rejectDisallowedUsername(e, auth.getString("username"));

  var hash = e.request.pathValue("hash");
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return e.json(400, { error: "Invalid asset hash." });
  }

  var record = h.findAssetCatalogWith($app, hash.toLowerCase());
  if (!record) return e.json(404, { error: "Asset not found." });

  hash = hash.toLowerCase();
  if (h.serveAsset(e, record, hash)) return;
  return e.json(404, { error: "Asset file not found." });
});

routerAdd(
  "POST",
  "/api/admin/assets/migrate-r2-to-local",
  (e) => {
    var h = require(`${__hooks}/keiai.js`);
    var body = e.requestInfo().body || {};
    var result = h.migrateR2AssetsToLocal(body.limit);
    if (result.error) return e.json(400, result);
    return e.json(200, result);
  },
  $apis.requireSuperuserAuth(),
);

// Asset usage hooks

onRecordAfterCreateSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).reconcilePendingAssetUsage(
      e.record.getString("hash"),
    );
  } catch (_) {}
}, "asset_catalog");

onRecordAfterCreateSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).handleAssetRefTransition(e.record, null);
  } catch (_) {}
}, "records");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).handleAssetRefTransition(
      e.record,
      e.record.original(),
    );
  } catch (_) {}
}, "records");

onRecordAfterDeleteSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).handleAssetRefTransition(null, e.record);
  } catch (_) {}
}, "records");

onRecordAfterCreateSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).handleAssetRefTransition(e.record, null);
  } catch (_) {}
}, "multi_room_records");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).handleAssetRefTransition(
      e.record,
      e.record.original(),
    );
  } catch (_) {}
}, "multi_room_records");

onRecordAfterDeleteSuccess((e) => {
  e.next();
  try {
    require(`${__hooks}/keiai.js`).handleAssetRefTransition(null, e.record);
  } catch (_) {}
}, "multi_room_records");

// Asset garbage collection

cronAdd("asset-gc", "0 * * * *", () => {
  var pageSize = 200;

  while (true) {
    var orphans = arrayOf(
      new DynamicModel({
        id: "",
        hash: "",
      }),
    );
    $app
      .db()
      .newQuery(
        "SELECT c.id, c.hash FROM asset_catalog c WHERE NOT EXISTS " +
          "(SELECT 1 FROM asset_usage u WHERE u.hash = c.hash) " +
          "AND c.recoveryProtected = false " +
          "AND c.createdAt < (unixepoch() - 3600) * 1000 LIMIT {:limit}",
      )
      .bind({ limit: pageSize })
      .all(orphans);

    if (!orphans || orphans.length === 0) break;

    for (var i = 0; i < orphans.length; i++) {
      try {
        var h = require(`${__hooks}/keiai.js`);
        var hash = String(orphans[i].hash || "").toLowerCase();
        if (!hash) continue;
        if (h.hasAssetUsage(hash)) {
          continue;
        }
        var record = $app.findRecordById("asset_catalog", orphans[i].id);
        if (!h.deleteAssetBytes(hash)) {
          continue;
        }
        $app.delete(record);
      } catch (_) {}
    }

    if (orphans.length < pageSize) break;
  }
});
