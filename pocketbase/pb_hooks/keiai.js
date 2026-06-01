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
  account.set("usedBytes", "0");
  account.set("maxBytes", "0");
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
  return { status: 200, body: { member: serializeMultiRoomMember(member) } };
}

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
    room = index;
  });

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
        account.set("usedBytes", String(used + catalogSize));
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
    account.set("usedBytes", String(used + size));
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
      account.set("usedBytes", String(used + size));
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
    account.set("usedBytes", String(Math.max(used - size, 0)));
    account.set("updatedAt", now);
    txApp.save(account);
  });
}

function parseAssetEntries(record) {
  if (!record || record.getBool("isDeleted")) return {};
  if (record.getString("kind") === "chats") return {};

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
  for (var i = 7; i >= 0; i--) {
    msg.push((bitLength / Math.pow(256, i)) & 255);
  }

  for (var chunk = 0; chunk < msg.length; chunk += 64) {
    var w = new Array(64);
    for (var j = 0; j < 16; j++) {
      var idx = chunk + j * 4;
      w[j] =
        ((msg[idx] << 24) |
          (msg[idx + 1] << 16) |
          (msg[idx + 2] << 8) |
          msg[idx + 3]) >>>
        0;
    }
    for (var j2 = 16; j2 < 64; j2++) {
      var s0 =
        rightRotate(w[j2 - 15], 7) ^
        rightRotate(w[j2 - 15], 18) ^
        (w[j2 - 15] >>> 3);
      var s1 =
        rightRotate(w[j2 - 2], 17) ^
        rightRotate(w[j2 - 2], 19) ^
        (w[j2 - 2] >>> 10);
      w[j2] = (w[j2 - 16] + s0 + w[j2 - 7] + s1) >>> 0;
    }

    var a = h[0],
      b = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      hh = h[7];

    for (var round = 0; round < 64; round++) {
      var S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (hh + S1 + ch + k[round] + w[round]) >>> 0;
      var S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;

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
    var bytes = toBytes(reader, 10 * 1024 * 1024 + 1);
    if (!bytes || bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
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
  var rows = [];
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
      var bytes = toBytes(reader, 10 * 1024 * 1024 + 1);
      if (!bytes || bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
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

  var remainingRows = [];
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
  var rows = [];
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
  getAuthRecord: getAuthRecord,
  getAssetMaxBytes: getAssetMaxBytes,
  getMultiRoomUploadOwner: getMultiRoomUploadOwner,
  getUserPublicKey: getUserPublicKey,
  getOrCreateAssetAccount: getOrCreateAssetAccount,
  getNumberField: getNumberField,
  getPairingBlobs: getPairingBlobs,
  handleAssetRefTransition: handleAssetRefTransition,
  hasAssetUsage: hasAssetUsage,
  isNoRowsError: isNoRowsError,
  isUsernameAllowed: isUsernameAllowed,
  leaveMultiRoom: leaveMultiRoom,
  migrateR2AssetsToLocal: migrateR2AssetsToLocal,
  normalizeUsername: normalizeUsername,
  rejectDisallowedAuth: rejectDisallowedAuth,
  rejectDisallowedUsername: rejectDisallowedUsername,
  reconcilePendingAssetUsage: reconcilePendingAssetUsage,
  searchPublicMultiRooms: searchPublicMultiRooms,
  serveAsset: serveAsset,
  setPairingBlobs: setPairingBlobs,
  sha256Bytes: sha256Bytes,
  storeAssetBytes: storeAssetBytes,
};
