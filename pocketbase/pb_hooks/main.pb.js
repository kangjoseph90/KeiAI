/// <reference path="../pb_data/types.d.ts" />

/**
 * KeiAI E2EE Backend Hooks
 *
 * Custom endpoints for the E2EE Authentication dance.
 * The client needs the user's salt and recovery data BEFORE logging in.
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

  $app.store().set("hexToBase64", function (hex, byteCount) {
    var chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var bytes = [];
    for (var i = 0; i < byteCount * 2 && i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    var result = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      result += chars[b0 >> 2];
      result += chars[((b0 & 3) << 4) | (b1 >> 4)];
      result +=
        i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : "=";
      result += i + 2 < bytes.length ? chars[b2 & 63] : "=";
    }
    return result;
  });
}

// ─── Configuration ───────────────────────────────────────────────────

var DUMMY_SALT_SECRET = $os.getenv("DUMMY_SALT_SECRET");

if (!DUMMY_SALT_SECRET) {
  console.log(
    "WARNING: DUMMY_SALT_SECRET env var is not set. " +
      "Salt endpoint will reject requests until configured.",
  );
}

var DEFAULT_ASSET_QUOTA_BYTES = 50 * 1024 * 1024;

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

function getNumberField(record, fieldName, fallback) {
  try {
    var intValue = record.getInt(fieldName);
    if (typeof intValue === "number" && !isNaN(intValue)) return intValue;
  } catch (_) {}

  try {
    var rawValue = record.get(fieldName);
    var parsed = Number(rawValue);
    if (!isNaN(parsed)) return parsed;
  } catch (_) {}

  return fallback;
}

function getAssetCatalogRecord(hash) {
  try {
    return $app.findFirstRecordByData("assetCatalog", "hash", hash);
  } catch (_) {
    return null;
  }
}

// ─── 1. Get Salt (Blind Fetch before login) ──────────────────────────

routerAdd("GET", "/api/salt/{email}", (e) => {
  var checkRate = $app.store().get("checkRate");
  var hexToBase64 = $app.store().get("hexToBase64");
  var DUMMY_SALT_SECRET = $os.getenv("DUMMY_SALT_SECRET");

  var ip = e.realIP();
  if (!checkRate(ip + ":salt", 20, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  if (!DUMMY_SALT_SECRET) {
    return e.json(500, { error: "Server misconfiguration." });
  }

  var email = e.request.pathValue("email");

  try {
    var record = $app.findFirstRecordByData("users", "email", email);
    return e.json(200, { salt: record.getString("salt") });
  } catch (_err) {
    // User not found — return deterministic dummy salt in Base64 format
    // (identical to real salt format) to prevent email enumeration.
    var hmacHex = $security.hs256(DUMMY_SALT_SECRET, email);
    var dummySalt = hexToBase64(hmacHex, 16);
    return e.json(200, { salt: dummySalt });
  }
});

// ─── 2. Get Recovery Bundle (M(Z)) before recovering ────────────────

routerAdd("GET", "/api/recovery-bundle/{email}", (e) => {
  var checkRate = $app.store().get("checkRate");

  var ip = e.realIP();
  if (!checkRate(ip + ":recovery-bundle", 5, 60000)) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  var email = e.request.pathValue("email");
  try {
    var record = $app.findFirstRecordByData("users", "email", email);
    return e.json(200, {
      encryptedRecoveryMasterKey: record.getString(
        "encryptedRecoveryMasterKey",
      ),
      encryptedRecoveryMasterKeyIV: record.getString("recoveryMasterKeyIv"),
    });
  } catch (_err) {
    // Return 200 with empty strings to prevent email enumeration.
    // The client will fail during decryption (bad ciphertext), revealing nothing.
    return e.json(200, {
      encryptedRecoveryMasterKey: "",
      encryptedRecoveryMasterKeyIV: "",
    });
  }
});

// ─── 3. Recover Account ─────────────────────────────────────────────

routerAdd("POST", "/api/recover-account/{email}", (e) => {
  var checkRate = $app.store().get("checkRate");
  var constantTimeEqual = $app.store().get("constantTimeEqual");

  var ip = e.realIP();
  var email = e.request.pathValue("email");

  // Rate limit by both IP and email to prevent distributed brute-force
  if (
    !checkRate(ip + ":recover", 5, 60000) ||
    !checkRate("email:" + email + ":recover", 5, 300000)
  ) {
    return e.json(429, { error: "Too many requests. Try again later." });
  }

  try {
    var rawBody = e.requestInfo().body || {};
    var body = {
      authTokenHash: rawBody.authTokenHash || "",
      password: rawBody.password || "",
      passwordConfirm: rawBody.passwordConfirm || "",
      salt: rawBody.salt || "",
      encryptedMasterKey: rawBody.encryptedMasterKey || "",
      masterKeyIv: rawBody.masterKeyIv || "",
      encryptedRecoveryMasterKey: rawBody.encryptedRecoveryMasterKey || "",
      recoveryMasterKeyIv: rawBody.recoveryMasterKeyIv || "",
      recoveryAuthTokenHash: rawBody.recoveryAuthTokenHash || "",
    };

    var record;
    try {
      record = $app.findFirstRecordByData("users", "email", email);
    } catch (_err) {
      // User not found — return same generic error to prevent enumeration
      return e.json(401, { error: "Recovery failed." });
    }

    // Constant-time comparison to prevent timing attacks
    var storedHash = record.getString("recoveryAuthTokenHash");
    if (!constantTimeEqual(storedHash, body.authTokenHash)) {
      return e.json(401, { error: "Recovery failed." });
    }

    // Update all credential fields
    record.setPassword(body.password);
    record.set("salt", body.salt);
    record.set("encryptedMasterKey", body.encryptedMasterKey);
    record.set("masterKeyIv", body.masterKeyIv);
    record.set("encryptedRecoveryMasterKey", body.encryptedRecoveryMasterKey);
    record.set("recoveryMasterKeyIv", body.recoveryMasterKeyIv);
    record.set("recoveryAuthTokenHash", body.recoveryAuthTokenHash);

    $app.save(record);

    return e.json(200, { success: true });
  } catch (err) {
    return e.json(500, { error: "Recovery failed." });
  }
});

// ─── 4. Asset Upload ───────────────────────────────────────────────

routerAdd("POST", "/api/assets/upload", (e) => {
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
    var record = new Record(collection);
    record.set("hash", hash);
    record.set("ownerId", auth.id);
    record.set("kind", kind);
    record.set("size", size);
    record.set("refCount", 1);
    record.set("file", file);

    $app.save(record);

    user.set("assetUsage", assetUsage + size);
    $app.save(user);

    return e.json(200, { status: "uploaded", hash: hash });
  } catch (err) {
    return e.json(500, { error: "Upload failed: " + err.toString() });
  }
});

// ─── 5. Asset Deletion ──────────────────────────────────────────────

routerAdd("DELETE", "/api/assets/{hash}", (e) => {
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
    user.set("assetUsage", Math.max(assetUsage - size, 0));
    $app.save(user);
    $app.delete(record);
    return e.json(200, { deleted: true, status: "deleted", hash: hash });
  }
});

// ─── 6. Asset Promotion ─────────────────────────────────────────────

routerAdd("PUT", "/api/assets/promote/{hash}", (e) => {
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
  record.set("kind", "public");
  record.set("file", file);
  $app.save(record);

  user.set("assetUsage", Math.max(assetUsage - size, 0));
  $app.save(user);

  return e.json(200, { status: "promoted", hash: hash });
});
