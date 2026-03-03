/// <reference path="../pb_data/types.d.ts" />

/**
 * KeiAI E2EE Backend Hooks
 * 
 * Provides custom endpoints needed for the E2EE Authentication dance,
 * since the client needs the user's salt and recovery data BEFORE logging in.
 */

/**
 * Convert a hex string to a Base64 string.
 * Used so dummy salts match the 24-char Base64 format of real salts.
 * @param {string} hex
 * @returns {string}
 */
function hexToBase64(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return $security.base64Encode(String.fromCharCode(...bytes));
}

// 1. Get Salt (Blind Fetch before login)
routerAdd("GET", "/api/salt/:email", (c) => {
    const email = c.pathParam("email");
    const secret = $os.getenv("DUMMY_SALT_SECRET") || "fallback-insecure-key";

    // Always compute the dummy salt to prevent timing attacks.
    // For a real user, this result is discarded; for a fake user, it is returned.
    const dummyHex = $security.hs256(secret, email);
    // Take only the first 16 bytes (32 hex chars) to match the real 16-byte salt length,
    // then encode as Base64 to match the 24-char Base64 format sent by the client.
    const dummySalt = hexToBase64(dummyHex.substring(0, 32));

    try {
        const record = $app.dao().findFirstRecordByData("users", "email", email);
        return c.json(200, { salt: record.getString("salt") });
    } catch (_err) {
        // User not found — return deterministic dummy salt to prevent email enumeration
        return c.json(200, { salt: dummySalt });
    }
});

// 2. Get Recovery Bundle (M(Z)) before recovering
routerAdd("GET", "/api/recovery-bundle/:email", (c) => {
    const email = c.pathParam("email");
    try {
        const record = $app.dao().findFirstRecordByData("users", "email", email);
        return c.json(200, { 
            encryptedRecoveryMasterKey: record.getString("encryptedRecoveryMasterKey"),
            encryptedRecoveryMasterKeyIV: record.getString("recoveryMasterKeyIv")
        });
    } catch (_err) {
        return c.json(404, { error: "User not found" });
    }
});

// 3. Post New Account Data after Recovery
routerAdd("POST", "/api/recover-account/:email", (c) => {
    const email = c.pathParam("email");
    
    // Parse the incoming JSON body
    const body = new DynamicModel({
        authTokenHash: "",
        password: "",
        passwordConfirm: "",
        salt: "",
        encryptedMasterKey: "",
        masterKeyIv: "",
        encryptedRecoveryMasterKey: "",
        recoveryMasterKeyIv: "",
        recoveryAuthTokenHash: ""
    });
    c.bind(body);

    try {
        const record = $app.dao().findFirstRecordByData("users", "email", email);
        
        // VERIFY: Check if the provided authTokenHash matches the one in DB
        if (record.getString("recoveryAuthTokenHash") !== body.authTokenHash) {
            return c.json(401, { error: "Invalid recovery auth token" });
        }

        // UPDATE: Replace all keys with the new recovery payload
        // Note: Pocketbase allows updating the password normally via setPassword
        record.setPassword(body.password);
        record.set("salt", body.salt);
        record.set("encryptedMasterKey", body.encryptedMasterKey);
        record.set("masterKeyIv", body.masterKeyIv);
        record.set("encryptedRecoveryMasterKey", body.encryptedRecoveryMasterKey);
        record.set("recoveryMasterKeyIv", body.recoveryMasterKeyIv);
        record.set("recoveryAuthTokenHash", body.recoveryAuthTokenHash);

        $app.dao().saveRecord(record);

        return c.json(200, { success: true });
    } catch (_err) {
        return c.json(500, { error: "Recovery failed" });
    }
});
