/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
    // 1. Update users collection with E2EE fields
    const usersCollection = app.findCollectionByNameOrId("_pb_users_auth_");
    
    const userFields = [
        { name: "salt", type: "text" },
        { name: "encryptedMasterKey", type: "text" },
        { name: "masterKeyIv", type: "text" },
        { name: "encryptedRecoveryMasterKey", type: "text" },
        { name: "recoveryMasterKeyIv", type: "text" },
        { name: "recoveryAuthTokenHash", type: "text" }
    ];

    let userChanged = false;
    for (const f of userFields) {
        let exists = false;
        try { exists = !!usersCollection.fields.getByName(f.name); } catch (_) {}
        
        if (!exists) {
            usersCollection.fields.add(new Field({
                name: f.name,
                type: f.type,
                required: false,
                presentable: false,
                primaryKey: false,
                system: false,
            }));
            userChanged = true;
        }
    }
    
    if (userChanged) {
        app.save(usersCollection);
    }

    // 2. Create E2EE Encrypted Tables securely
    const authRule = "userId = @request.auth.id";
    const createRule = "@request.auth.id != ''";

    function createEncryptedTable(name, extraFields) {
        let exists = false;
        try { exists = !!app.findCollectionByNameOrId(name); } catch (_) {}
        if (exists) return; // Skip if already created
        
        const collection = new Collection({
            name: name,
            type: "base",
            listRule: authRule,
            viewRule: authRule,
            createRule: createRule,
            updateRule: authRule,
            deleteRule: authRule,
        });

        // Use 'relation' type so that deleting a user cascades and wipes their E2EE data
        collection.fields.add(new Field({
            name: "userId",
            type: "relation",
            required: true,
            collectionId: usersCollection.id,
            cascadeDelete: true,
            maxSelect: 1
        }));

        collection.fields.add(new Field({ name: "encryptedData", type: "text", required: true }));
        collection.fields.add(new Field({ name: "encryptedDataIV", type: "text", required: true }));
        collection.fields.add(new Field({ name: "isDeleted", type: "bool" }));

        if (extraFields) {
            for (const f of extraFields) {
                collection.fields.add(new Field(f));
            }
        }

        app.save(collection);

        // Add index for fast sync queries
        try {
            app.db()
                .newQuery(`CREATE INDEX IF NOT EXISTS "idx_${name}_sync" ON "${name}" (userId, \`updated\`)`)
                .execute();
        } catch (_) {}
    }

    // ─── Standard Encrypted Tables ───────────────────────────────────
    createEncryptedTable("characterSummaries");
    createEncryptedTable("characterData");
    createEncryptedTable("settings");
    createEncryptedTable("personas");
    createEncryptedTable("modules");
    createEncryptedTable("plugins");
    createEncryptedTable("presetSummaries");
    createEncryptedTable("presetData");
    createEncryptedTable("assets");
    
    createEncryptedTable("lorebooks", [
        { name: "ownerId", type: "text", required: true }
    ]);
    createEncryptedTable("scripts", [
        { name: "ownerId", type: "text", required: true }
    ]);

    // ─── Chat Relations ───────────────────────────────────────────────
    createEncryptedTable("chatSummaries", [
        { name: "characterId", type: "text", required: true }
    ]);
    createEncryptedTable("chatData", [
        { name: "characterId", type: "text", required: true }
    ]);

    // ─── Message Relations ────────────────────────────────────────────
    createEncryptedTable("messages", [
        { name: "chatId", type: "text", required: true },
        { name: "sortOrder", type: "text", required: true }
    ]);

}, (app) => {
    // DOWN MIGRATION (Rollback)

    // 1. Remove all created tables
    const tables = [
        "messages", "chatData", "chatSummaries",
        "scripts", "lorebooks", "assets",
        "presetData", "presetSummaries", "plugins", "modules", 
        "personas", "settings", "characterData", "characterSummaries"
    ];

    for (const name of tables) {
        try {
            const collection = app.findCollectionByNameOrId(name);
            app.delete(collection);
        } catch (_) {} // ignore if not exists
    }

    // 2. Remove added fields from users
    try {
        const usersCollection = app.findCollectionByNameOrId("_pb_users_auth_");
        const userFields = [
            "salt", "encryptedMasterKey", "masterKeyIv", 
            "encryptedRecoveryMasterKey", "recoveryMasterKeyIv", "recoveryAuthTokenHash"
        ];
        
        let userChanged = false;
        for (const f of userFields) {
            try {
                const field = usersCollection.fields.getByName(f);
                if (field) {
                    usersCollection.fields.removeById(field.id);
                    userChanged = true;
                }
            } catch (_) {}
        }
        
        if (userChanged) {
            app.save(usersCollection);
        }
    } catch (_) {}
});
