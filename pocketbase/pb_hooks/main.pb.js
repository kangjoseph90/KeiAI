/// <reference path="../pb_data/types.d.ts" />

/**
 * KeiAI E2EE Backend Hooks
 * 
 * Provides custom endpoints needed for the E2EE Authentication dance,
 * since the client needs the user's salt and recovery data BEFORE logging in.
 */

// Helper to generate a deterministic base64 string
function generateDeterministicBase64(inputStr, byteLength) {
    // Basic deterministic PRNG based on string hash
    let hash = 0;
    for (let i = 0; i < inputStr.length; i++) {
        let char = inputStr.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }

    // Convert hash to positive
    hash = Math.abs(hash);

    // Generate deterministic bytes
    let resultBytes = [];
    let prngState = hash === 0 ? 123456789 : hash;
    for (let i = 0; i < byteLength; i++) {
        prngState = (prngState * 9301 + 49297) % 233280;
        resultBytes.push(Math.floor((prngState / 233280) * 256));
    }

    // Base64 encode the bytes manually
    let byteStr = "";
    for (let i = 0; i < resultBytes.length; i++) {
        byteStr += String.fromCharCode(resultBytes[i]);
    }

    let base64 = "";
    let b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < byteStr.length; i += 3) {
        let b1 = byteStr.charCodeAt(i) & 0xFF;
        let b2 = i + 1 < byteStr.length ? byteStr.charCodeAt(i + 1) & 0xFF : 0;
        let b3 = i + 2 < byteStr.length ? byteStr.charCodeAt(i + 2) & 0xFF : 0;

        let enc1 = b1 >> 2;
        let enc2 = ((b1 & 3) << 4) | (b2 >> 4);
        let enc3 = ((b2 & 15) << 2) | (b3 >> 6);
        let enc4 = b3 & 63;

        if (i + 1 >= byteStr.length) {
            enc3 = enc4 = 64;
        } else if (i + 2 >= byteStr.length) {
            enc4 = 64;
        }

        base64 += b64chars.charAt(enc1) + b64chars.charAt(enc2);
        if (enc3 < 64) base64 += b64chars.charAt(enc3); else base64 += "=";
        if (enc4 < 64) base64 += b64chars.charAt(enc4); else base64 += "=";
    }

    return base64;
}

// 1. Get Salt (Blind Fetch before login)
routerAdd("GET", "/api/salt/:email", (c) => {
    let email = c.pathParam("email");
    try {
        let record = $app.dao().findFirstRecordByData("users", "email", email);
        return c.json(200, { salt: record.getString("salt") });
    } catch (err) {
        // Return a dummy salt to prevent email enumeration
        // Generate a deterministic 16-byte dummy salt based on the email
        let dummySalt = generateDeterministicBase64(email + ":salt", 16);
        return c.json(200, { salt: dummySalt });
    }
});

// 2. Get Recovery Bundle (M(Z)) before recovering
routerAdd("GET", "/api/recovery-bundle/:email", (c) => {
    let email = c.pathParam("email");
    try {
        let record = $app.dao().findFirstRecordByData("users", "email", email);
        return c.json(200, { 
            encryptedRecoveryMasterKey: record.getString("encryptedRecoveryMasterKey"),
            encryptedRecoveryMasterKeyIV: record.getString("recoveryMasterKeyIv")
        });
    } catch (err) {
        // Return a dummy bundle to prevent email enumeration
        // Master key is 32 bytes + 16 bytes auth tag = 48 bytes
        // IV is 12 bytes
        let dummyKey = generateDeterministicBase64(email + ":recovery:key", 48);
        let dummyIV = generateDeterministicBase64(email + ":recovery:iv", 12);

        return c.json(200, {
            encryptedRecoveryMasterKey: dummyKey,
            encryptedRecoveryMasterKeyIV: dummyIV
        });
    }
});

// 3. Post New Account Data after Recovery
routerAdd("POST", "/api/recover-account/:email", (c) => {
    let email = c.pathParam("email");
    
    // Parse the incoming JSON body
    let body = new DynamicModel({
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
        let record = $app.dao().findFirstRecordByData("users", "email", email);
        
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
    } catch (err) {
        return c.json(500, { error: "Recovery failed" });
    }
});
