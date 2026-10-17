var MAX_ASSET_CIPHERTEXT_BYTES = 100 * 1024 * 1024 + 16;

function maxAssetCiphertextBytes() {
  return MAX_ASSET_CIPHERTEXT_BYTES;
}

function getStoreObject(key, fallback) {
  var store = $app.store();
  if (!store.has(key)) {
    store.set(key, JSON.stringify(fallback));
  }
  var val = store.get(key);
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch (_) {
      return fallback;
    }
  }
  return val;
}

function setStoreObject(key, value) {
  $app.store().set(key, JSON.stringify(value));
}

function checkRate(key, maxRequests, windowMs) {
  var now = Date.now();
  var rateState = getStoreObject("keiaiRateState", {
    buckets: {},
    requestCounter: 0,
  });
  var buckets = rateState.buckets || {};

  rateState.requestCounter = Number(rateState.requestCounter || 0) + 1;
  if (rateState.requestCounter > 100) {
    rateState.requestCounter = 0;
    var maxWindowMs = 300000;
    for (var k in buckets) {
      buckets[k] = buckets[k].filter(function (t) {
        return t > now - maxWindowMs;
      });
      if (buckets[k].length === 0) {
        delete buckets[k];
      }
    }
  }

  if (!buckets[key]) buckets[key] = [];
  buckets[key] = buckets[key].filter(function (t) {
    return t > now - windowMs;
  });

  if (buckets[key].length >= maxRequests) {
    rateState.buckets = buckets;
    setStoreObject("keiaiRateState", rateState);
    return false;
  }

  buckets[key].push(now);
  rateState.buckets = buckets;
  setStoreObject("keiaiRateState", rateState);
  return true;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function hexToBytes(hex, byteCount) {
  var bytes = [];
  for (var i = 0; i < hex.length && bytes.length < byteCount; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function bytesToBase64(bytes) {
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
}

function dummySaltForUsername(username) {
  var secret = $os.getenv("DUMMY_SALT_SECRET");
  var normalized = normalizeUsername(username);
  var digest = $security.sha256(secret + ":" + normalized);
  var bytes = /^[0-9a-f]+$/i.test(digest)
    ? hexToBytes(digest, 16)
    : Array.from(String(digest).slice(0, 16)).map(function (ch) {
        return ch.charCodeAt(0) & 255;
      });
  return bytesToBase64(bytes);
}

function getAuthRecord(e) {
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
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

function allowedUsernameConfig() {
  var config = getStoreObject("keiaiAllowedUsernameConfig", null);
  if (config) return config;

  config = { enabled: false, usernames: {} };
  var raw = $os.getenv("PB_ALLOWED_USERNAMES");
  if (raw) {
    raw = String(raw).trim();
    if (
      (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') ||
      (raw.charAt(0) === "'" && raw.charAt(raw.length - 1) === "'")
    ) {
      raw = raw.slice(1, -1);
    }

    var count = 0;
    String(raw)
      .split(/[\s,]+/)
      .forEach(function (part) {
        var username = normalizeUsername(part);
        var key = "$" + username;
        if (!username || config.usernames[key]) return;
        config.usernames[key] = true;
        count++;
      });
    config.enabled = count > 0;
  }

  setStoreObject("keiaiAllowedUsernameConfig", config);
  return config;
}

function isUsernameAllowed(username) {
  var config = allowedUsernameConfig();
  if (!config || !config.enabled) return true;
  return Boolean(config.usernames["$" + normalizeUsername(username)]);
}

function getAuthUsername(e) {
  var auth = getAuthRecord(e);
  if (!auth) return "";
  try {
    return normalizeUsername(auth.getString("username"));
  } catch (_) {}
  return "";
}

function rejectDisallowedUsername(e, username) {
  var normalized = normalizeUsername(username);
  if (isUsernameAllowed(normalized)) return false;
  throw new ForbiddenError("Username is not allowed on this server.", null);
}

function rejectDisallowedAuth(e) {
  var username = getAuthUsername(e);
  if (!username) return false;
  return rejectDisallowedUsername(e, username);
}

function getNumberField(record, fieldName, fallback) {
  try {
    var rawValue = record.get(fieldName);
    if (rawValue === null || rawValue === "") return fallback;
    var parsed = Number(rawValue);
    if (!isNaN(parsed)) return parsed;
  } catch (_) {}
  return fallback;
}

var syncRecordFields = {
  records: [
    "userId",
    "kind",
    "createdAt",
    "updatedAt",
    "encryptedData",
    "encryptedDataIV",
    "isDeleted",
    "tombstoneAt",
    "assetEntries",
    "serverUpdatedAt",
  ],
  multi_room_records: [
    "roomId",
    "kind",
    "createdAt",
    "updatedAt",
    "encryptedData",
    "encryptedDataIV",
    "isDeleted",
    "tombstoneAt",
    "assetEntries",
    "serverUpdatedAt",
  ],
  multi_room_index: [
    "ownerUserId",
    "visibility",
    "publicName",
    "createdAt",
    "updatedAt",
    "isDeleted",
    "serverUpdatedAt",
  ],
  multi_room_members: [
    "roomId",
    "userId",
    "status",
    "encryptedRoomKey",
    "createdAt",
    "updatedAt",
    "serverUpdatedAt",
  ],
};

// Canonical sync records use the client supplied updatedAt as their LWW
// version, but serverUpdatedAt is the server change order that Pull cursors
// follow. It is a commit-ordered revision: SQLite triggers assign it inside the
// same write transaction as the change, and SQLite admits one writer at a
// time, so once revision N is visible every lower revision is committed. A
// rolled-back write takes its revision with it. Hooks never assign it.
var SYNC_REVISION_TABLE = "sync_revision";

function syncRevisionTriggerNames() {
  var names = [];
  for (var collectionName in syncRecordFields) {
    names.push(collectionName + "_sync_revision_insert");
    names.push(collectionName + "_sync_revision_update");
  }
  return names;
}

/** Idempotently install the revision counter and its triggers. */
function ensureSyncRevisionTriggers(app) {
  app
    .db()
    .newQuery(
      "CREATE TABLE IF NOT EXISTS " +
        SYNC_REVISION_TABLE +
        " (id INTEGER PRIMARY KEY CHECK (id = 0), value INTEGER NOT NULL)",
    )
    .execute();
  app
    .db()
    .newQuery(
      "INSERT OR IGNORE INTO " +
        SYNC_REVISION_TABLE +
        " (id, value) VALUES (0, 0)",
    )
    .execute();
  for (var collectionName in syncRecordFields) {
    // tombstoneAt is server-local retention metadata, not replicated state.
    var canonical = syncRecordFields[collectionName].filter(function (field) {
      return field !== "serverUpdatedAt" && field !== "tombstoneAt";
    });
    var changed = canonical
      .map(function (field) {
        return "OLD." + field + " IS NOT NEW." + field;
      })
      .join(" OR ");
    var stamp =
      "UPDATE " +
      SYNC_REVISION_TABLE +
      " SET value = value + 1 WHERE id = 0; UPDATE " +
      collectionName +
      " SET serverUpdatedAt = (SELECT value FROM " +
      SYNC_REVISION_TABLE +
      " WHERE id = 0) WHERE id = NEW.id;";
    app
      .db()
      .newQuery(
        "CREATE TRIGGER IF NOT EXISTS " +
          collectionName +
          "_sync_revision_insert AFTER INSERT ON " +
          collectionName +
          " BEGIN " +
          stamp +
          " END",
      )
      .execute();
    // Rejected writes restore every canonical field, so they keep their position.
    app
      .db()
      .newQuery(
        "CREATE TRIGGER IF NOT EXISTS " +
          collectionName +
          "_sync_revision_update AFTER UPDATE OF " +
          canonical.join(", ") +
          " ON " +
          collectionName +
          " WHEN " +
          changed +
          " BEGIN " +
          stamp +
          " END",
      )
      .execute();
  }
}

/**
 * Refuse to write or serve sync data while the ordering triggers are missing,
 * for example after a collection rebuild: unordered changes could be skipped.
 */
function assertSyncRevisionTriggers(app) {
  var names = syncRevisionTriggerNames();
  var row = new DynamicModel({ n: 0 });
  app
    .db()
    .select("COUNT(*) AS n")
    .from("sqlite_master")
    .where($dbx.hashExp({ type: "trigger" }))
    .andWhere($dbx.in("name", ...names))
    .one(row);
  if (Number(row.n) !== names.length) {
    throw new ApiError(503, "Sync ordering is unavailable.");
  }
}

/** Highest committed server change; every change at or below it is visible. */
function getSyncRevision(app) {
  assertSyncRevisionTriggers(app);
  var row = new DynamicModel({ value: 0 });
  app
    .db()
    .newQuery("SELECT value FROM " + SYNC_REVISION_TABLE + " WHERE id = 0")
    .one(row);
  return Number(row.value) || 0;
}

/** Allocate a revision inside the caller's transaction. */
function nextSyncRevision(txApp) {
  txApp
    .db()
    .newQuery(
      "UPDATE " + SYNC_REVISION_TABLE + " SET value = value + 1 WHERE id = 0",
    )
    .execute();
  var row = new DynamicModel({ value: 0 });
  txApp
    .db()
    .newQuery("SELECT value FROM " + SYNC_REVISION_TABLE + " WHERE id = 0")
    .one(row);
  return Number(row.value) || 0;
}

function copySyncRecordFields(target, source, collectionName) {
  var fields = syncRecordFields[collectionName];
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    target.set(field, source.get(field));
  }
}

/**
 * Apply server-side LWW/delete-wins to a canonical sync record update.
 *
 * A rejected update is turned into a no-op by restoring every canonical field
 * from the original record. This is intentional: PocketBase still completes
 * the request successfully, but serverUpdatedAt (and all other canonical
 * state) remains unchanged. A deleted record can never be resurrected.
 */
function applySyncRecordUpdate(record, collectionName) {
  var original = record.original();
  if (!original || !original.id) return true;

  var incomingUpdatedAt = getNumberField(record, "updatedAt", 0);
  var originalUpdatedAt = getNumberField(original, "updatedAt", 0);
  var incomingDeleted = !!record.get("isDeleted");
  var originalDeleted = !!original.get("isDeleted");

  // Delete-wins is unconditional for a tombstone: a live record always accepts
  // an incoming delete, and no later live write may resurrect it. Records with
  // the same deletion state use the larger client updatedAt.
  var accepted =
    (!originalDeleted && incomingDeleted) ||
    (incomingDeleted === originalDeleted &&
      incomingUpdatedAt > originalUpdatedAt);

  if (!accepted) {
    copySyncRecordFields(record, original, collectionName);
    return false;
  }

  if (tombstoneScopes[collectionName]) {
    // Retention counts from when this server first held the current tombstone
    // version, so a newer version that takes a fresh revision is kept as long.
    record.set("tombstoneAt", incomingDeleted ? Date.now() : 0);
  }
  // The update trigger assigns the new revision when the change commits.
  record.set("serverUpdatedAt", original.get("serverUpdatedAt"));
  return true;
}

function stampSyncRecordCreate(record) {
  if (tombstoneScopes[record.collection().name]) {
    record.set("tombstoneAt", record.getBool("isDeleted") ? Date.now() : 0);
  }
  // The insert trigger assigns the revision when the change commits.
  record.set("serverUpdatedAt", 0);
}

// ─── Tombstone GC merge safety ─────────────────────────────────────
//
// A garbage-collected tombstone is a forgotten deletion. `sync_scopes.gcHigh`
// bounds the serverUpdatedAt of every deletion this server forgot, and a peer
// covers it either through its Pull cursor or a shared History–Clean
// checkpoint anchored at or above it. See docs/sync-gc.md.

var TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
var CHECKPOINT_RETENTION_MS = 2 * TOMBSTONE_RETENTION_MS;
var MAX_SYNC_CHECKPOINT_IDS = 1000;
var GC_SCOPE_PAGE = 100;

var tombstoneScopes = {
  records: { scopeType: "user", ownerField: "userId" },
  multi_room_records: { scopeType: "room", ownerField: "roomId" },
};

/** Highest position whose forgotten deletions the peer provably knows. */
function syncCoverage(cursor, anchors) {
  var high = cursor;
  for (var i = 0; i < anchors.length; i++) {
    if (anchors[i] > high) high = anchors[i];
  }
  return high;
}

function readSyncNumber(value) {
  return typeof value === "number" && isFinite(value) && value >= 0
    ? value
    : null;
}

function readSyncRequest(body) {
  var scopeType = body.scopeType;
  var scopeId = body.scopeId;
  var pullCursor = readSyncNumber(body.pullCursor);
  var ids = body.checkpoints;
  if (
    (scopeType !== "user" && scopeType !== "room") ||
    typeof scopeId !== "string" ||
    !scopeId ||
    pullCursor === null ||
    !isSyncIdList(ids)
  ) {
    return null;
  }
  return {
    scopeType: scopeType,
    scopeId: scopeId,
    pullCursor: pullCursor,
    checkpoints: ids,
  };
}

function isSyncIdList(ids) {
  if (!Array.isArray(ids) || ids.length > MAX_SYNC_CHECKPOINT_IDS) return false;
  for (var i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== "string" || !ids[i] || ids[i].length > 64) {
      return false;
    }
  }
  return true;
}

function canAccessSyncScope(app, auth, scopeType, scopeId) {
  if (scopeType === "user") return scopeId === auth.id;
  var room = findMultiRoomIndex(app, scopeId);
  if (!room || room.getBool("isDeleted")) return false;
  var member = findMultiRoomMember(app, scopeId, auth.id);
  return !!member && member.getString("status") === "accepted";
}

function getSyncGcHigh(app, scopeType, scopeId) {
  var row = new DynamicModel({ gcHigh: 0 });
  try {
    app
      .db()
      .newQuery(
        "SELECT gcHigh FROM sync_scopes WHERE scopeType = {:scopeType} AND scopeId = {:scopeId}",
      )
      .bind({ scopeType: scopeType, scopeId: scopeId })
      .one(row);
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return 0;
  }
  return Number(row.gcHigh) || 0;
}

function raiseSyncGcHigh(app, scopeType, scopeId, gcHigh) {
  var record;
  try {
    record = app.findFirstRecordByFilter(
      "sync_scopes",
      "scopeType = {:scopeType} && scopeId = {:scopeId}",
      { scopeType: scopeType, scopeId: scopeId },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    record = new Record(app.findCollectionByNameOrId("sync_scopes"));
    record.set("scopeType", scopeType);
    record.set("scopeId", scopeId);
  }
  if (gcHigh <= getNumberField(record, "gcHigh", 0)) return;
  record.set("gcHigh", gcHigh);
  app.save(record);
}

function findSyncCheckpoints(app, scopeType, scopeId, ids) {
  if (ids.length === 0) return [];
  var rows = arrayOf(
    new DynamicModel({ checkpointId: "", anchor: 0, heldAt: 0 }),
  );
  app
    .db()
    .select("checkpointId", "anchor", "heldAt")
    .from("sync_checkpoints")
    .where($dbx.hashExp({ scopeType: scopeType, scopeId: scopeId }))
    .andWhere($dbx.in("checkpointId", ...ids))
    .all(rows);
  return rows;
}

function anchorsOf(rows) {
  var anchors = [];
  for (var i = 0; i < rows.length; i++)
    anchors.push(Number(rows[i].anchor) || 0);
  return anchors;
}

function hasSyncCheckpoints(app, scopeType, scopeId) {
  var row = new DynamicModel({ n: 0 });
  app
    .db()
    .newQuery(
      "SELECT COUNT(*) AS n FROM sync_checkpoints WHERE scopeType = {:scopeType} AND scopeId = {:scopeId}",
    )
    .bind({ scopeType: scopeType, scopeId: scopeId })
    .one(row);
  return Number(row.n) > 0;
}

function addSyncCheckpoint(
  app,
  scopeType,
  scopeId,
  checkpointId,
  anchor,
  heldAt,
) {
  var record = new Record(app.findCollectionByNameOrId("sync_checkpoints"));
  record.set("scopeType", scopeType);
  record.set("scopeId", scopeId);
  record.set("checkpointId", checkpointId);
  record.set("anchor", anchor);
  record.set("heldAt", heldAt);
  record.set("createdAt", Date.now());
  app.save(record);
}

/**
 * Report this server's GC state and prove which client checkpoints it holds.
 * The client refuses the session unless both directions are covered.
 */
function syncHandshake(app, auth, body) {
  var request = readSyncRequest(body || {});
  if (!request)
    return { status: 400, body: { error: "Invalid sync request." } };
  if (!canAccessSyncScope(app, auth, request.scopeType, request.scopeId)) {
    return { status: 403, body: { error: "Sync scope is not accessible." } };
  }

  var gcHigh = getSyncGcHigh(app, request.scopeType, request.scopeId);
  var held = findSyncCheckpoints(
    app,
    request.scopeType,
    request.scopeId,
    request.checkpoints,
  );
  var known = [];
  for (var i = 0; i < held.length; i++)
    known.push(String(held[i].checkpointId));
  return {
    status: 200,
    body: {
      gcHigh: gcHigh,
      coverage: syncCoverage(request.pullCursor, anchorsOf(held)),
      known: known,
      initialized:
        gcHigh > 0 ||
        hasSyncCheckpoints(app, request.scopeType, request.scopeId),
    },
  };
}

/**
 * Confirm a session boundary atomically with this server's GC.
 *
 * The client may advance its Pull cursor only after this succeeds: a GC that
 * forgot an uncovered deletion during the Pull fails the commit. On success
 * the server inherits the client's checkpoints, records a newly issued one
 * anchored at the session's Pull bound, and returns the checkpoints it held
 * within the Pull range for the client to inherit.
 */
function syncCommit(auth, body) {
  body = body || {};
  var request = readSyncRequest(body);
  var serverUpper = readSyncNumber(body.serverUpper);
  var inherit = body.inherit;
  var issued = body.checkpoint;
  if (
    !request ||
    serverUpper === null ||
    serverUpper < request.pullCursor ||
    !isSyncIdList(inherit) ||
    (issued !== undefined && !isSyncIdList([issued]))
  ) {
    return { status: 400, body: { error: "Invalid sync request." } };
  }

  var result = null;
  $app.runInTransaction(function (txApp) {
    if (!canAccessSyncScope(txApp, auth, request.scopeType, request.scopeId)) {
      result = {
        status: 403,
        body: { error: "Sync scope is not accessible." },
      };
      return;
    }
    var scopeType = request.scopeType;
    var scopeId = request.scopeId;
    var held = findSyncCheckpoints(
      txApp,
      scopeType,
      scopeId,
      request.checkpoints,
    );
    var gcHigh = getSyncGcHigh(txApp, scopeType, scopeId);
    if (gcHigh > syncCoverage(request.pullCursor, anchorsOf(held))) {
      result = {
        status: 409,
        body: { code: "sync_unsafe", error: "Merge is not proven safe." },
      };
      return;
    }

    // A fresh revision orders after every committed Push of the session and
    // after every Pull bound a client could have read before this commit.
    var heldAt = nextSyncRevision(txApp);
    if (serverUpper >= heldAt) {
      result = { status: 400, body: { error: "Invalid sync request." } };
      return;
    }

    var inherited = [];
    var heldIds = {};
    var existing = findSyncCheckpoints(
      txApp,
      scopeType,
      scopeId,
      inherit.concat(issued ? [issued] : []),
    );
    for (var i = 0; i < existing.length; i++) {
      heldIds[existing[i].checkpointId] = true;
    }
    if (issued) {
      if (heldIds[issued]) {
        result = { status: 409, body: { error: "Checkpoint already exists." } };
        return;
      }
      addSyncCheckpoint(txApp, scopeType, scopeId, issued, serverUpper, heldAt);
      heldIds[issued] = true;
    }
    for (var j = 0; j < inherit.length; j++) {
      if (heldIds[inherit[j]]) continue;
      addSyncCheckpoint(txApp, scopeType, scopeId, inherit[j], 0, heldAt);
      heldIds[inherit[j]] = true;
    }

    var rows = arrayOf(new DynamicModel({ checkpointId: "" }));
    txApp
      .db()
      .newQuery(
        "SELECT checkpointId FROM sync_checkpoints WHERE scopeType = {:scopeType} AND scopeId = {:scopeId} AND heldAt > {:after} AND heldAt <= {:through}",
      )
      .bind({
        scopeType: scopeType,
        scopeId: scopeId,
        after: request.pullCursor,
        through: serverUpper,
      })
      .all(rows);
    for (var k = 0; k < rows.length; k++)
      inherited.push(String(rows[k].checkpointId));
    result = { status: 200, body: { checkpoints: inherited } };
  });
  return result;
}

/**
 * Sync records are written only through /api/batch. A batch loads the original
 * record and runs these request hooks inside its transaction, so delete-wins
 * arbitration and the create guard see committed state that GC cannot change
 * before the write. A plain collection request has no such transaction.
 */
function assertSyncWriteTransactional(e) {
  if (!e.app.isTransactional()) {
    throw new BadRequestError(
      "Sync records must be written through /api/batch.",
    );
  }
}

/**
 * Refuse a live create the pushing client cannot prove safe. A create is the
 * only write that can resurrect a deletion this server has forgotten.
 */
function assertSyncCreateCovered(e) {
  var record = e.record;
  if (!record || record.getBool("isDeleted")) return;
  var scope = tombstoneScopes[record.collection().name];
  if (!scope) return;
  var gcHigh = getSyncGcHigh(
    e.app,
    scope.scopeType,
    record.getString(scope.ownerField),
  );
  if (gcHigh === 0) return;
  var headers = e.requestInfo().headers || {};
  var coverage = Number(headers["x_kei_sync_coverage"]);
  if (!(coverage >= gcHigh)) {
    // PocketBase rewrites the message casing; clients match the code case-insensitively.
    throw new ApiError(409, "Merge is not proven safe (sync_unsafe).");
  }
}

/**
 * Delete tombstones first held before the retention window. Each scope raises
 * its watermark and deletes in one transaction, and only tombstones at or
 * below the raised watermark are removed.
 */
function collectSyncTombstones(now) {
  var receivedThrough = now - TOMBSTONE_RETENTION_MS;
  var collected = 0;
  for (var collectionName in tombstoneScopes) {
    var scope = tombstoneScopes[collectionName];
    var expired =
      "isDeleted = TRUE AND tombstoneAt > 0 AND tombstoneAt <= {:receivedThrough}";
    // Keyset over scope ids: each scope is visited once per run, even if it
    // still holds expired tombstones afterwards.
    var afterScopeId = "";
    while (true) {
      var scopes = arrayOf(new DynamicModel({ scopeId: "" }));
      $app
        .db()
        .newQuery(
          "SELECT DISTINCT " +
            scope.ownerField +
            " AS scopeId FROM " +
            collectionName +
            " WHERE " +
            expired +
            " AND " +
            scope.ownerField +
            " > {:afterScopeId} ORDER BY scopeId LIMIT {:limit}",
        )
        .bind({
          receivedThrough: receivedThrough,
          afterScopeId: afterScopeId,
          limit: GC_SCOPE_PAGE,
        })
        .all(scopes);

      for (var i = 0; i < scopes.length; i++) {
        var scopeId = String(scopes[i].scopeId);
        $app.runInTransaction(function (txApp) {
          var params = { scopeId: scopeId, receivedThrough: receivedThrough };
          var high = new DynamicModel({ high: 0 });
          txApp
            .db()
            .newQuery(
              "SELECT COALESCE(MAX(serverUpdatedAt), 0) AS high FROM " +
                collectionName +
                " WHERE " +
                scope.ownerField +
                " = {:scopeId} AND " +
                expired,
            )
            .bind(params)
            .one(high);
          var gcHigh = Number(high.high) || 0;
          if (gcHigh === 0) return;
          raiseSyncGcHigh(txApp, scope.scopeType, scopeId, gcHigh);
          var deleted = txApp
            .db()
            .newQuery(
              "DELETE FROM " +
                collectionName +
                " WHERE " +
                scope.ownerField +
                " = {:scopeId} AND " +
                expired +
                " AND serverUpdatedAt <= {:gcHigh}",
            )
            .bind({
              scopeId: scopeId,
              receivedThrough: receivedThrough,
              gcHigh: gcHigh,
            })
            .execute();
          collected += Number(deleted.rowsAffected()) || 0;
        });
      }
      if (scopes.length < GC_SCOPE_PAGE) break;
      afterScopeId = String(scopes[scopes.length - 1].scopeId);
    }
  }

  $app
    .db()
    .newQuery("DELETE FROM sync_checkpoints WHERE createdAt < {:createdBefore}")
    .bind({ createdBefore: now - CHECKPOINT_RETENTION_MS })
    .execute();
  return collected;
}

function isNoRowsError(err) {
  var text = String((err && (err.message || err.toString())) || "");
  return /no rows|not found/i.test(text);
}

function findAssetCatalogWith(app, hash) {
  try {
    return app.findFirstRecordByData("asset_catalog", "hash", hash);
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return null;
  }
}

function findAssetUsageWith(app, userId, hash) {
  try {
    return app.findFirstRecordByFilter(
      "asset_usage",
      "userId = {:userId} && hash = {:hash}",
      { userId: userId, hash: hash },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return null;
  }
}

function findPendingAssetUsagesWith(app, hash) {
  try {
    return app.findRecordsByFilter(
      "asset_usage",
      "hash = {:hash} && (size = 0 || size = null)",
      "",
      0,
      0,
      { hash: hash },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return [];
  }
}

function findAssetAccountWith(app, userId) {
  try {
    return app.findFirstRecordByData("asset_accounts", "userId", userId);
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return null;
  }
}

function getOrCreateAssetAccount(app, userId) {
  var account = findAssetAccountWith(app, userId);
  if (account) return account;

  var now = Date.now();
  var collection = app.findCollectionByNameOrId("asset_accounts");
  account = new Record(collection);
  account.set("userId", userId);
  account.set("usedBytes", 0);
  account.set("maxBytes", 0);
  account.set("createdAt", now);
  account.set("updatedAt", now);
  try {
    app.save(account);
    return account;
  } catch (err) {
    var existing = findAssetAccountWith(app, userId);
    if (existing) return existing;
    throw err;
  }
}

function findMultiRoomIndex(app, roomId) {
  try {
    return app.findRecordById("multi_room_index", roomId);
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return null;
  }
}

function findMultiRoomMember(app, roomId, userId) {
  try {
    return app.findFirstRecordByFilter(
      "multi_room_members",
      "roomId = {:roomId} && userId = {:userId}",
      { roomId: roomId, userId: userId },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return null;
  }
}

function findMultiRoomRecordsByRoom(app, collectionName, roomId) {
  return app.findRecordsByFilter(
    collectionName,
    "roomId = {:roomId}",
    "",
    0,
    0,
    { roomId: roomId },
  );
}

function searchPublicMultiRooms(query) {
  var filter = 'visibility = "public" && isDeleted = false';
  var params = {};
  var name = String(query || "").trim();
  if (name) {
    filter += " && publicName ~ {:name}";
    params.name = name;
  }

  return $app
    .findRecordsByFilter(
      "multi_room_index",
      filter,
      "-updatedAt",
      50,
      0,
      params,
    )
    .map(serializeMultiRoomIndex);
}

function getUserPublicKey(userId) {
  var user = null;
  try {
    user = $app.findRecordById("users", userId);
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return { status: 404, body: { error: "User not found." } };
  }

  if (!isUsernameAllowed(user.getString("username"))) {
    return { status: 404, body: { error: "User not found." } };
  }

  var publicKey = user.getString("identityPublicKey");
  if (!publicKey) {
    return { status: 404, body: { error: "User public key not found." } };
  }

  return {
    status: 200,
    body: {
      userId: user.id,
      username: user.getString("username"),
      identityPublicKey: JSON.parse(publicKey),
    },
  };
}

function serializeMultiRoomIndex(record) {
  return {
    id: record.id,
    ownerUserId: record.getString("ownerUserId"),
    visibility: record.getString("visibility"),
    publicName: record.getString("publicName") || undefined,
    createdAt: getNumberField(record, "createdAt", 0),
    updatedAt: getNumberField(record, "updatedAt", 0),
    serverUpdatedAt: getNumberField(record, "serverUpdatedAt", 0),
    isDeleted: record.getBool("isDeleted"),
  };
}

function serializeMultiRoomMember(record) {
  return {
    id: record.id,
    roomId: record.getString("roomId"),
    userId: record.getString("userId"),
    status: record.getString("status"),
    encryptedRoomKey: record.getString("encryptedRoomKey") || undefined,
    createdAt: getNumberField(record, "createdAt", 0),
    updatedAt: getNumberField(record, "updatedAt", 0),
    serverUpdatedAt: getNumberField(record, "serverUpdatedAt", 0),
  };
}

function createOrUpdateJoinRequest(auth, roomId) {
  var room = findMultiRoomIndex($app, roomId);
  if (!room || room.getBool("isDeleted")) {
    return { status: 404, body: { error: "Multi room not found." } };
  }

  var member = null;
  var now = Date.now();
  $app.runInTransaction(function (txApp) {
    member = findMultiRoomMember(txApp, roomId, auth.id);
    if (!member) {
      var collection = txApp.findCollectionByNameOrId("multi_room_members");
      member = new Record(collection);
      member.set("roomId", roomId);
      member.set("userId", auth.id);
      member.set("createdAt", now);
    }

    if (member.getString("status") !== "accepted") {
      member.set("status", "pending");
      member.set("encryptedRoomKey", "");
    }
    member.set("updatedAt", now);
    txApp.save(member);
  });

  member = $app.findRecordById("multi_room_members", member.id);
  return { status: 200, body: { member: serializeMultiRoomMember(member) } };
}

function leaveMultiRoom(auth, roomId) {
  var room = findMultiRoomIndex($app, roomId);
  if (!room || room.getBool("isDeleted")) {
    return { status: 404, body: { error: "Multi room not found." } };
  }
  if (room.getString("ownerUserId") === auth.id) {
    return { status: 400, body: { error: "Room owner must delete the room." } };
  }

  var member = null;
  var now = Date.now();
  $app.runInTransaction(function (txApp) {
    member = findMultiRoomMember(txApp, roomId, auth.id);
    if (!member) return;
    member.set("status", "left");
    member.set("encryptedRoomKey", "");
    member.set("updatedAt", now);
    txApp.save(member);
  });

  if (!member) {
    return { status: 404, body: { error: "Multi membership not found." } };
  }
  member = $app.findRecordById("multi_room_members", member.id);
  return { status: 200, body: { member: serializeMultiRoomMember(member) } };
}

// ─── User delete cascade ──────────────────────────────────────────

function findRecordsByUser(app, collectionName, userId) {
  try {
    return app.findRecordsByFilter(
      collectionName,
      "userId = {:userId}",
      "",
      0,
      0,
      { userId: userId },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return [];
  }
}

function findOwnedMultiRoomIndexes(app, userId) {
  try {
    return app.findRecordsByFilter(
      "multi_room_index",
      "ownerUserId = {:ownerUserId} && isDeleted = false",
      "",
      0,
      0,
      { ownerUserId: userId },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return [];
  }
}

function findMultiRoomMembershipsByUser(app, userId) {
  try {
    return app.findRecordsByFilter(
      "multi_room_members",
      "userId = {:userId}",
      "",
      0,
      0,
      { userId: userId },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return [];
  }
}

function findAssetUsagesByUser(app, userId) {
  try {
    return app.findRecordsByFilter(
      "asset_usage",
      "userId = {:userId}",
      "",
      0,
      0,
      { userId: userId },
    );
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return [];
  }
}

/**
 * Cascade-delete all data for a user account.
 *
 * 1. Hard-delete user-scoped records (asset hooks fire)
 * 2. User-owned rooms: soft-delete index + hard-delete room records
 * 3. Memberships: hard-delete every row for this user
 * 4. Cleanup asset_usage + asset_account
 * 5. Hard-delete user auth record
 */
function deleteUserCascade(userRecord) {
  var userId = userRecord.id;
  var now = Date.now();

  // Phase 1: Data cascade in transaction
  $app.runInTransaction(function (txApp) {
    // 1. Hard-delete user-scoped records
    var userRecords = findRecordsByUser(txApp, "records", userId);
    for (var i = 0; i < userRecords.length; i++) {
      txApp.delete(userRecords[i]);
    }

    // 2. User-owned rooms: soft-delete index + hard-delete records
    var ownedRooms = findOwnedMultiRoomIndexes(txApp, userId);
    for (var j = 0; j < ownedRooms.length; j++) {
      var roomId = ownedRooms[j].id;
      var roomRecords = findMultiRoomRecordsByRoom(
        txApp,
        "multi_room_records",
        roomId,
      );
      for (var k = 0; k < roomRecords.length; k++) {
        txApp.delete(roomRecords[k]);
      }
      ownedRooms[j].set("isDeleted", true);
      ownedRooms[j].set("updatedAt", now);
      txApp.save(ownedRooms[j]);
    }

    // 3. Memberships: hard delete every row for this user
    var memberships = findMultiRoomMembershipsByUser(txApp, userId);
    for (var m = 0; m < memberships.length; m++) {
      txApp.delete(memberships[m]);
    }
  });

  // Phase 2: Asset cleanup (outside transaction to avoid nesting issues)
  var usages = findAssetUsagesByUser($app, userId);
  for (var u = 0; u < usages.length; u++) {
    try {
      $app.delete(usages[u]);
    } catch (_) {}
  }

  var account = findAssetAccountWith($app, userId);
  if (account) {
    try {
      $app.delete(account);
    } catch (_) {}
  }

  // Phase 3: Hard-delete user auth record
  $app.delete(userRecord);
}

// ─── Multi-room lifecycle ──────────────────────────────────────────

function deleteMultiRoom(auth, roomId) {
  var room = findMultiRoomIndex($app, roomId);
  if (!room) {
    return { status: 404, body: { error: "Multi room not found." } };
  }
  if (room.getString("ownerUserId") !== auth.id) {
    return {
      status: 403,
      body: { error: "Only the room owner can delete it." },
    };
  }

  var now = Date.now();
  $app.runInTransaction(function (txApp) {
    var records = findMultiRoomRecordsByRoom(
      txApp,
      "multi_room_records",
      roomId,
    );
    for (var i = 0; i < records.length; i++) {
      if (records[i]) txApp.delete(records[i]);
    }

    var index = txApp.findRecordById("multi_room_index", roomId);
    index.set("isDeleted", true);
    index.set("updatedAt", now);
    txApp.save(index);
  });

  room = $app.findRecordById("multi_room_index", roomId);
  return { status: 200, body: { room: serializeMultiRoomIndex(room) } };
}

function getAssetUsageUserId(app, record) {
  var collectionName = "";
  try {
    collectionName = record.collection().name;
  } catch (_) {}

  if (collectionName === "multi_room_records") {
    var roomId = record.getString("roomId");
    var room = findMultiRoomIndex(app, roomId);
    return room ? room.getString("ownerUserId") : "";
  }

  return record.getString("userId");
}

function getMultiRoomUploadOwner(auth, roomId) {
  var room = findMultiRoomIndex($app, roomId);
  if (!room || room.getBool("isDeleted")) {
    return { status: 404, body: { error: "Multi room not found." } };
  }

  var member = findMultiRoomMember($app, roomId, auth.id);
  if (!member || member.getString("status") !== "accepted") {
    return { status: 403, body: { error: "Multi room access denied." } };
  }

  return { status: 200, ownerUserId: room.getString("ownerUserId") };
}

function incrementUsage(userId, hash) {
  var now = Date.now();
  if (!userId || !hash) return;

  $app.runInTransaction(function (txApp) {
    var usage = findAssetUsageWith(txApp, userId, hash);
    if (usage) {
      var currentSize = getNumberField(usage, "size", 0);
      var catalog = findAssetCatalogWith(txApp, hash);
      var catalogSize = catalog ? getNumberField(catalog, "size", 0) : 0;

      usage.set("refCount", getNumberField(usage, "refCount", 0) + 1);

      if (currentSize === 0 && catalogSize > 0) {
        usage.set("size", catalogSize);

        var account = getOrCreateAssetAccount(txApp, userId);
        var used = getNumberField(account, "usedBytes", 0);
        account.set("usedBytes", used + catalogSize);
        account.set("updatedAt", now);
        txApp.save(account);
      }

      usage.set("updatedAt", now);
      txApp.save(usage);
      return;
    }

    var catalog = findAssetCatalogWith(txApp, hash);
    var size = catalog ? getNumberField(catalog, "size", 0) : 0;

    var collection = txApp.findCollectionByNameOrId("asset_usage");
    var created = new Record(collection);
    created.set("userId", userId);
    created.set("hash", hash);
    created.set("refCount", 1);
    created.set("size", size);
    created.set("createdAt", now);
    created.set("updatedAt", now);
    txApp.save(created);

    if (size <= 0) return;

    var account = getOrCreateAssetAccount(txApp, userId);
    var used = getNumberField(account, "usedBytes", 0);
    account.set("usedBytes", used + size);
    account.set("updatedAt", now);
    txApp.save(account);
  });
}

function reconcilePendingAssetUsage(hash) {
  var now = Date.now();
  if (!hash) return;

  $app.runInTransaction(function (txApp) {
    var catalog = findAssetCatalogWith(txApp, hash);
    if (!catalog) return;

    var size = getNumberField(catalog, "size", 0);
    if (size <= 0) return;

    var usages = findPendingAssetUsagesWith(txApp, hash);
    for (var i = 0; i < usages.length; i++) {
      var usage = usages[i];
      if (!usage) continue;

      usage.set("size", size);
      usage.set("updatedAt", now);
      txApp.save(usage);

      var userId = usage.getString("userId");
      var account = getOrCreateAssetAccount(txApp, userId);
      var used = getNumberField(account, "usedBytes", 0);
      account.set("usedBytes", used + size);
      account.set("updatedAt", now);
      txApp.save(account);
    }
  });
}

function decrementUsage(userId, hash) {
  var now = Date.now();
  if (!userId || !hash) return;

  $app.runInTransaction(function (txApp) {
    var usage = findAssetUsageWith(txApp, userId, hash);
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

    var account = getOrCreateAssetAccount(txApp, userId);
    var used = getNumberField(account, "usedBytes", 0);
    account.set("usedBytes", Math.max(used - size, 0));
    account.set("updatedAt", now);
    txApp.save(account);
  });
}

function parseAssetEntries(record) {
  if (!record || record.getBool("isDeleted")) return {};

  var raw = record.getString("assetEntries");
  if (!raw) return {};

  try {
    var parsed = JSON.parse(raw);
    var entries = {};
    for (var hash in parsed) {
      if (!Object.prototype.hasOwnProperty.call(parsed, hash)) continue;
      if (parsed[hash] === "remote") {
        entries[String(hash).toLowerCase()] = true;
      }
    }
    return entries;
  } catch (_) {
    return {};
  }
}

function handleAssetRefTransition(record, oldRecord) {
  var oldUserId = oldRecord ? getAssetUsageUserId($app, oldRecord) : "";
  var newUserId = record ? getAssetUsageUserId($app, record) : "";
  var oldEntries = parseAssetEntries(oldRecord);
  var newEntries = parseAssetEntries(record);

  if (oldUserId && oldUserId !== newUserId) {
    for (var oldHash in oldEntries) {
      if (Object.prototype.hasOwnProperty.call(oldEntries, oldHash)) {
        decrementUsage(oldUserId, oldHash);
      }
    }
    oldEntries = {};
  }

  if (newUserId && oldUserId !== newUserId) {
    for (var newHash in newEntries) {
      if (Object.prototype.hasOwnProperty.call(newEntries, newHash)) {
        incrementUsage(newUserId, newHash);
      }
    }
    return;
  }

  var userId = newUserId || oldUserId;
  if (!userId) return;

  for (var removedHash in oldEntries) {
    if (
      Object.prototype.hasOwnProperty.call(oldEntries, removedHash) &&
      !newEntries[removedHash]
    ) {
      decrementUsage(userId, removedHash);
    }
  }

  for (var addedHash in newEntries) {
    if (
      Object.prototype.hasOwnProperty.call(newEntries, addedHash) &&
      !oldEntries[addedHash]
    ) {
      incrementUsage(userId, addedHash);
    }
  }
}

function sha256Bytes(bytes) {
  return $security.sha256(toString(bytes));
}

function findRecoveryRecord(e, rateKey, maxRequests) {
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
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return { error: e.json(401, { error: "Recovery failed." }) };
  }
  var storedHash = record.getString("recoveryAuthTokenHash");
  if (!constantTimeEqual(storedHash, authTokenHash)) {
    return { error: e.json(401, { error: "Recovery failed." }) };
  }
  if (!isUsernameAllowed(record.getString("username"))) {
    return { error: e.json(401, { error: "Recovery failed." }) };
  }
  return { record: record, body: body };
}

function getDefaultAssetQuotaBytes() {
  return Number($os.getenv("DEFAULT_ASSET_QUOTA_BYTES") || Infinity);
}

function getAssetMaxBytes(account) {
  var value = getNumberField(account, "maxBytes", -1);
  if (value > 0) return value;
  return getDefaultAssetQuotaBytes();
}

function normalizeEnv(value) {
  var normalized = String(value || "").trim();
  if (
    (normalized.charAt(0) === '"' &&
      normalized.charAt(normalized.length - 1) === '"') ||
    (normalized.charAt(0) === "'" &&
      normalized.charAt(normalized.length - 1) === "'")
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function getR2Config() {
  var bucket = normalizeEnv($os.getenv("R2_BUCKET"));
  var endpoint = normalizeEnv($os.getenv("R2_ENDPOINT"));
  var accessKey = normalizeEnv($os.getenv("R2_ACCESS_KEY_ID"));
  var secretKey = normalizeEnv($os.getenv("R2_SECRET_ACCESS_KEY"));
  if (!bucket || !endpoint || !accessKey || !secretKey) return null;

  return {
    bucket: bucket,
    region: normalizeEnv($os.getenv("R2_REGION")) || "auto",
    endpoint: endpoint,
    accessKey: accessKey,
    secretKey: secretKey,
    forcePathStyle:
      normalizeEnv($os.getenv("R2_FORCE_PATH_STYLE")).toLowerCase() !== "false",
  };
}

function assetObjectKey(hash) {
  return "assets/" + String(hash || "").toLowerCase() + ".bin";
}

function newR2Filesystem() {
  var config = getR2Config();
  if (!config) return null;
  return $filesystem.s3(
    config.bucket,
    config.region,
    config.endpoint,
    config.accessKey,
    config.secretKey,
    config.forcePathStyle,
  );
}

function parseR2AssetObject(object) {
  if (!object || object.isDir) return null;

  var match = /^assets\/([0-9a-f]{64})\.bin$/i.exec(String(object.key || ""));
  var size = Number(object.size || 0);
  if (
    !match ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > MAX_ASSET_CIPHERTEXT_BYTES
  ) {
    return null;
  }

  return {
    hash: match[1].toLowerCase(),
    size: size,
  };
}

function recoverR2AssetCatalog() {
  if (!getR2Config()) {
    return {
      configured: false,
      scanned: 0,
      recovered: 0,
      existing: 0,
      skipped: 0,
      failed: 0,
    };
  }

  var fsys = newR2Filesystem();
  if (!fsys) {
    throw new Error("Failed to initialize R2 filesystem.");
  }

  var result = {
    configured: true,
    scanned: 0,
    recovered: 0,
    existing: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    var objects = fsys.list("assets/");
    result.scanned = objects.length;

    for (var i = 0; i < objects.length; i++) {
      var asset = parseR2AssetObject(objects[i]);
      if (!asset) {
        result.skipped++;
        continue;
      }
      if (findAssetCatalogWith($app, asset.hash)) {
        result.existing++;
        continue;
      }

      try {
        var collection = $app.findCollectionByNameOrId("asset_catalog");
        var record = new Record(collection);
        record.set("hash", asset.hash);
        record.set("size", asset.size);
        record.set("recoveryProtected", true);
        record.set("createdAt", Date.now());
        $app.save(record);
        reconcilePendingAssetUsage(asset.hash);
        result.recovered++;
      } catch (err) {
        // A concurrent writer may have restored the same hash after our lookup.
        if (findAssetCatalogWith($app, asset.hash)) {
          result.existing++;
        } else {
          result.failed++;
        }
      }
    }
  } finally {
    fsys.close();
  }

  return result;
}

function getLegacyAssetFileKey(record) {
  if (!record) return "";
  var filename = record.getString("data");
  if (!filename) return "";
  return record.baseFilesPath() + "/" + filename;
}

function hasAssetInR2(hash) {
  var fsys = newR2Filesystem();
  if (!fsys) return false;
  try {
    return fsys.exists(assetObjectKey(hash));
  } catch (_) {
    return false;
  } finally {
    fsys.close();
  }
}

function uploadAssetToR2(hash, bytes) {
  var fsys = newR2Filesystem();
  if (!fsys) return;
  try {
    fsys.upload(bytes, assetObjectKey(hash));
  } finally {
    fsys.close();
  }
}

function serveAssetFromR2(e, hash) {
  var fsys = newR2Filesystem();
  if (!fsys) return false;
  try {
    var key = assetObjectKey(hash);
    if (!fsys.exists(key)) return false;
    fsys.serve(e.response, e.request, key, String(hash).toLowerCase() + ".bin");
    return true;
  } catch (_) {
    return false;
  } finally {
    fsys.close();
  }
}

function serveAssetFromLegacy(e, record, hash) {
  var fileKey = getLegacyAssetFileKey(record);
  if (!fileKey) return false;

  var fsys = $app.newFilesystem();
  try {
    fsys.serve(
      e.response,
      e.request,
      fileKey,
      String(hash).toLowerCase() + ".bin",
    );
    return true;
  } catch (_) {
    return false;
  } finally {
    fsys.close();
  }
}

function copyLegacyAssetToR2(record, hash) {
  if (!getR2Config()) return false;

  var fileKey = getLegacyAssetFileKey(record);
  if (!fileKey) return false;

  var legacy = $app.newFilesystem();
  var reader = null;
  try {
    if (!legacy.exists(fileKey)) return false;
    reader = legacy.getReader(fileKey);
    var bytes = toBytes(reader, MAX_ASSET_CIPHERTEXT_BYTES + 1);
    if (
      !bytes ||
      bytes.length === 0 ||
      bytes.length > MAX_ASSET_CIPHERTEXT_BYTES
    ) {
      return false;
    }
    uploadAssetToR2(hash, bytes);
    return true;
  } catch (_) {
    return false;
  } finally {
    if (reader) {
      try {
        reader.close();
      } catch (_) {}
    }
    legacy.close();
  }
}

function storeAssetBytes(hash, bytes, existing) {
  if (!getR2Config()) {
    if (existing) return { status: "exists", file: null };
    return {
      status: "stored",
      file: $filesystem.fileFromBytes(
        bytes,
        String(hash).toLowerCase() + ".bin",
      ),
    };
  }

  if (existing && hasAssetInR2(hash)) {
    return { status: "exists", file: null };
  }
  if (existing && copyLegacyAssetToR2(existing, hash)) {
    return { status: "migrated", file: null };
  }

  uploadAssetToR2(hash, bytes);
  return { status: "stored", file: null };
}

function serveAsset(e, record, hash) {
  if (getR2Config()) {
    if (serveAssetFromR2(e, hash)) return true;
    if (copyLegacyAssetToR2(record, hash) && serveAssetFromR2(e, hash)) {
      return true;
    }
  }

  return serveAssetFromLegacy(e, record, hash);
}

function migrateR2AssetsToLocal(limit) {
  if (!getR2Config()) {
    return { error: "R2 storage is not configured." };
  }

  var pageSize = Math.max(1, Math.min(Number(limit) || 50, 200));
  var rows = arrayOf(
    new DynamicModel({
      id: "",
    }),
  );
  $app
    .db()
    .newQuery(
      "SELECT id FROM asset_catalog " +
        "WHERE data IS NULL OR data = '' LIMIT {:limit}",
    )
    .bind({ limit: pageSize })
    .all(rows);

  var migrated = 0;
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < rows.length; i++) {
    var record = null;
    var reader = null;
    var r2 = null;
    try {
      record = $app.findRecordById("asset_catalog", rows[i].id);
      var hash = record.getString("hash").toLowerCase();
      r2 = newR2Filesystem();
      var key = assetObjectKey(hash);
      if (!r2 || !r2.exists(key)) {
        skipped++;
        continue;
      }

      reader = r2.getReader(key);
      var bytes = toBytes(reader, MAX_ASSET_CIPHERTEXT_BYTES + 1);
      if (
        !bytes ||
        bytes.length === 0 ||
        bytes.length > MAX_ASSET_CIPHERTEXT_BYTES
      ) {
        skipped++;
        continue;
      }

      record.set("data", $filesystem.fileFromBytes(bytes, hash + ".bin"));
      $app.save(record);
      migrated++;
    } catch (_) {
      failed++;
    } finally {
      if (reader) {
        try {
          reader.close();
        } catch (_) {}
      }
      if (r2) {
        try {
          r2.close();
        } catch (_) {}
      }
    }
  }

  var remainingRows = arrayOf(
    new DynamicModel({
      id: "",
    }),
  );
  $app
    .db()
    .newQuery(
      "SELECT id FROM asset_catalog " +
        "WHERE data IS NULL OR data = '' LIMIT 1",
    )
    .all(remainingRows);

  return {
    migrated: migrated,
    skipped: skipped,
    failed: failed,
    remaining: remainingRows.length,
  };
}

function deleteAssetBytes(hash) {
  if (!getR2Config()) return true;

  var fsys = newR2Filesystem();
  try {
    var key = assetObjectKey(hash);
    if (!fsys.exists(key)) return true;
    fsys.delete(key);
    return true;
  } catch (err) {
    if (isNoRowsError(err)) return true;
    return false;
  } finally {
    fsys.close();
  }
}

function hasAssetUsage(hash) {
  var rows = arrayOf(
    new DynamicModel({
      id: "",
    }),
  );
  $app
    .db()
    .newQuery("SELECT id FROM asset_usage WHERE hash = {:hash} LIMIT 1")
    .bind({ hash: hash })
    .all(rows);
  return rows.length > 0;
}

function getPairingBlobs() {
  return getStoreObject("keiaiPairingBlobs", {});
}

function setPairingBlobs(pairingBlobs) {
  setStoreObject("keiaiPairingBlobs", pairingBlobs);
}

module.exports = {
  checkRate: checkRate,
  deleteAssetBytes: deleteAssetBytes,
  dummySaltForUsername: dummySaltForUsername,
  findAssetCatalogWith: findAssetCatalogWith,
  findRecoveryRecord: findRecoveryRecord,
  createOrUpdateJoinRequest: createOrUpdateJoinRequest,
  deleteMultiRoom: deleteMultiRoom,
  deleteUserCascade: deleteUserCascade,
  getAuthRecord: getAuthRecord,
  getAssetMaxBytes: getAssetMaxBytes,
  getMultiRoomUploadOwner: getMultiRoomUploadOwner,
  getUserPublicKey: getUserPublicKey,
  getOrCreateAssetAccount: getOrCreateAssetAccount,
  getNumberField: getNumberField,
  ensureSyncRevisionTriggers: ensureSyncRevisionTriggers,
  assertSyncRevisionTriggers: assertSyncRevisionTriggers,
  getSyncRevision: getSyncRevision,
  applySyncRecordUpdate: applySyncRecordUpdate,
  stampSyncRecordCreate: stampSyncRecordCreate,
  syncCoverage: syncCoverage,
  syncHandshake: syncHandshake,
  syncCommit: syncCommit,
  assertSyncWriteTransactional: assertSyncWriteTransactional,
  assertSyncCreateCovered: assertSyncCreateCovered,
  collectSyncTombstones: collectSyncTombstones,
  getPairingBlobs: getPairingBlobs,
  handleAssetRefTransition: handleAssetRefTransition,
  hasAssetUsage: hasAssetUsage,
  isNoRowsError: isNoRowsError,
  isUsernameAllowed: isUsernameAllowed,
  leaveMultiRoom: leaveMultiRoom,
  migrateR2AssetsToLocal: migrateR2AssetsToLocal,
  maxAssetCiphertextBytes: maxAssetCiphertextBytes,
  normalizeUsername: normalizeUsername,
  rejectDisallowedAuth: rejectDisallowedAuth,
  rejectDisallowedUsername: rejectDisallowedUsername,
  recoverR2AssetCatalog: recoverR2AssetCatalog,
  reconcilePendingAssetUsage: reconcilePendingAssetUsage,
  searchPublicMultiRooms: searchPublicMultiRooms,
  serveAsset: serveAsset,
  setPairingBlobs: setPairingBlobs,
  sha256Bytes: sha256Bytes,
  storeAssetBytes: storeAssetBytes,
};
