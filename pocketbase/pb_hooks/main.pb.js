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
    var _rateBuckets = {};
    
    $app.store().set("checkRate", function(key, maxRequests, windowMs) {
        var now = Date.now();
        if (!_rateBuckets[key]) _rateBuckets[key] = [];
        _rateBuckets[key] = _rateBuckets[key].filter(function (t) { return t > now - windowMs; });
        if (_rateBuckets[key].length === 0) {
            delete _rateBuckets[key];
        } else if (_rateBuckets[key].length >= maxRequests) {
            return false;
        }
        
        if (!_rateBuckets[key]) _rateBuckets[key] = [];
        _rateBuckets[key].push(now);
        return true;
    });

    $app.store().set("constantTimeEqual", function(a, b) {
        if (typeof a !== "string" || typeof b !== "string") return false;
        if (a.length !== b.length) return false;
        var result = 0;
        for (var i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    });

    $app.store().set("hexToBase64", function(hex, byteCount) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var bytes = [];
        for (var i = 0; i < byteCount * 2 && i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substring(i, i + 2), 16));
        }
        var result = "";
        for (var i = 0; i < bytes.length; i += 3) {
            var b0 = bytes[i];
            var b1 = (i + 1 < bytes.length) ? bytes[i + 1] : 0;
            var b2 = (i + 2 < bytes.length) ? bytes[i + 2] : 0;
            result += chars[b0 >> 2];
            result += chars[((b0 & 3) << 4) | (b1 >> 4)];
            result += (i + 1 < bytes.length) ? chars[((b1 & 15) << 2) | (b2 >> 6)] : "=";
            result += (i + 2 < bytes.length) ? chars[b2 & 63] : "=";
        }
        return result;
    });
}

// ─── Configuration ───────────────────────────────────────────────────

var DUMMY_SALT_SECRET = $os.getenv("DUMMY_SALT_SECRET");

if (!DUMMY_SALT_SECRET) {
    console.log("WARNING: DUMMY_SALT_SECRET env var is not set. " +
        "Salt endpoint will reject requests until configured.");
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
            encryptedRecoveryMasterKey: record.getString("encryptedRecoveryMasterKey"),
            encryptedRecoveryMasterKeyIV: record.getString("recoveryMasterKeyIv")
        });
    } catch (_err) {
        // Return 200 with empty strings to prevent email enumeration.
        // The client will fail during decryption (bad ciphertext), revealing nothing.
        return e.json(200, { encryptedRecoveryMasterKey: "", encryptedRecoveryMasterKeyIV: "" });
    }
});

// ─── 3. Recover Account ─────────────────────────────────────────────

routerAdd("POST", "/api/recover-account/{email}", (e) => {
    var checkRate = $app.store().get("checkRate");
    var constantTimeEqual = $app.store().get("constantTimeEqual");
    
    var ip = e.realIP();
    var email = e.request.pathValue("email");

    // Rate limit by both IP and email to prevent distributed brute-force
    if (!checkRate(ip + ":recover", 5, 60000) ||
        !checkRate("email:" + email + ":recover", 5, 300000)) {
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
            recoveryAuthTokenHash: rawBody.recoveryAuthTokenHash || ""
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
