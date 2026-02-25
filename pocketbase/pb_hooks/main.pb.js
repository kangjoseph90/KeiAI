/// <reference path="../pb_data/types.d.ts" />

/**
 * KeiAI E2EE Backend Hooks
 * 
 * Provides custom endpoints needed for the E2EE Authentication dance,
 * since the client needs the user's salt and recovery data BEFORE logging in.
 */

// 1. Get Salt (Blind Fetch before login)
routerAdd("GET", "/api/salt/:email", (c) => {
    let email = c.pathParam("email");
    try {
        let record = $app.dao().findFirstRecordByData("users", "email", email);
        return c.json(200, { salt: record.getString("salt") });
    } catch (err) {
        // Return 404 or a dummy salt to prevent email enumeration (Best practice: dummy salt)
        return c.json(404, { error: "User not found" });
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
        return c.json(404, { error: "User not found" });
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
