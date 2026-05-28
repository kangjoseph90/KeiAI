function getStoreObject(key, fallback) {
  var store = $app.store();
  if (!store.has(key)) {
    store.set(key, fallback);
  }
  return store.get(key);
}

function setStoreObject(key, value) {
  $app.store().set(key, value);
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

function findMultiRoomIndex(app, roomId) {
  try {
    return app.findRecordById("multi_room_index", roomId);
  } catch (err) {
    if (!isNoRowsError(err)) throw err;
    return null;
  }
}

function getAssetUsageUserId(app, record) {
  var collectionName = "";
  try {
    collectionName = record.collection().name;
  } catch (_) {}

  if (collectionName === "multi_room_assets") {
    var roomId = record.getString("roomId");
    var room = findMultiRoomIndex(app, roomId);
    return room ? room.getString("ownerUserId") : "";
  }

  return record.getString("userId");
}

function incrementUsage(userId, hash) {
  var now = Date.now();
  if (!userId || !hash) return;

  $app.runInTransaction(function (txApp) {
    var usage = findAssetUsageWith(txApp, userId, hash);
    if (usage) {
      usage.set("refCount", getNumberField(usage, "refCount", 0) + 1);
      usage.set("updatedAt", now);
      txApp.save(usage);
      return;
    }

    var catalog = findAssetCatalogWith(txApp, hash);
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

    var user = txApp.findRecordById("users", userId);
    var used = getNumberField(user, "assetUsedBytes", 0);
    user.set("assetUsedBytes", Math.max(used - size, 0));
    txApp.save(user);
  });
}

function isLiveAssetRef(record) {
  return Boolean(
    record &&
      record.getString("status") === "remote" &&
      !record.getBool("isDeleted") &&
      record.getString("hash"),
  );
}

function handleAssetRefTransition(record, oldRecord) {
  var oldLive = isLiveAssetRef(oldRecord);
  var newLive = isLiveAssetRef(record);
  var oldHash = oldLive ? oldRecord.getString("hash").toLowerCase() : "";
  var newHash = newLive ? record.getString("hash").toLowerCase() : "";
  var oldUserId = oldLive ? getAssetUsageUserId($app, oldRecord) : "";
  var newUserId = newLive ? getAssetUsageUserId($app, record) : "";

  if (oldLive === newLive && oldHash === newHash && oldUserId === newUserId) {
    return;
  }

  if (oldLive && (!newLive || oldHash !== newHash || oldUserId !== newUserId)) {
    decrementUsage(oldUserId, oldHash);
  }
  if (newLive && (!oldLive || oldHash !== newHash || oldUserId !== newUserId)) {
    incrementUsage(newUserId, newHash);
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
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
    0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  var msg = bytes.slice();
  var bitLength = msg.length * 8;
  msg.push(0x80);
  while ((msg.length % 64) !== 56) msg.push(0);
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

function getAssetMaxBytes(user) {
  var value = getNumberField(user, "assetMaxBytes", -1);
  if (value > 0) return value;
  return getDefaultAssetQuotaBytes();
}

function getPairingBlobs() {
  return getStoreObject("keiaiPairingBlobs", {});
}

function setPairingBlobs(pairingBlobs) {
  setStoreObject("keiaiPairingBlobs", pairingBlobs);
}

module.exports = {
  checkRate: checkRate,
  dummySaltForUsername: dummySaltForUsername,
  findAssetCatalogWith: findAssetCatalogWith,
  findRecoveryRecord: findRecoveryRecord,
  getAuthRecord: getAuthRecord,
  getAssetMaxBytes: getAssetMaxBytes,
  getNumberField: getNumberField,
  getPairingBlobs: getPairingBlobs,
  handleAssetRefTransition: handleAssetRefTransition,
  isNoRowsError: isNoRowsError,
  isUsernameAllowed: isUsernameAllowed,
  normalizeUsername: normalizeUsername,
  rejectDisallowedAuth: rejectDisallowedAuth,
  rejectDisallowedUsername: rejectDisallowedUsername,
  setPairingBlobs: setPairingBlobs,
  sha256Bytes: sha256Bytes,
};
