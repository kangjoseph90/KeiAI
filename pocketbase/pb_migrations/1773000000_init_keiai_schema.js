/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Update users collection with E2EE fields
    const usersCollection = app.findCollectionByNameOrId("_pb_users_auth_");

    const userFields = [
      { name: "salt", type: "text" },
      { name: "encryptedMasterKey", type: "text" },
      { name: "masterKeyIv", type: "text" },
      { name: "encryptedRecoveryMasterKey", type: "text" },
      { name: "recoveryMasterKeyIv", type: "text" },
      { name: "recoveryAuthTokenHash", type: "text" },
      { name: "assetQuota", type: "number" },
      { name: "assetUsage", type: "number" },
      // Identity key pair for asymmetric encryption (multi-room Room Key exchange)
      { name: "identityPublicKey", type: "text" },           // ECDH P-256 public key as JWK JSON (plaintext)
      { name: "encryptedIdentityPrivateKey", type: "text" }, // Private key encrypted with M (AES-GCM, Base64)
      { name: "identityPrivateKeyIv", type: "text" },        // IV for private key encryption (Base64)
    ];

    let userChanged = false;
    for (const f of userFields) {
      let exists = false;
      try {
        exists = !!usersCollection.fields.getByName(f.name);
      } catch (_) {}

      if (!exists) {
        usersCollection.fields.add(
          new Field({
            name: f.name,
            type: f.type,
            required: false,
            presentable: false,
            primaryKey: false,
            system: false,
          }),
        );
        userChanged = true;
      }
    }

    if (userChanged) {
      app.save(usersCollection);
    }

    // 2. Create blind sync tables.
    // Local storage may keep plaintext, but PocketBase only stores encrypted sync blobs.
    // Ownership identifiers are plain text fields, not PocketBase relations/FKs.
    const authRule = "userId = @request.auth.id";
    const createRule = "userId = @request.auth.id";

    function createSyncTable(name, extraFields) {
      let exists = false;
      try {
        exists = !!app.findCollectionByNameOrId(name);
      } catch (_) {}
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

      collection.fields.add(
        new Field({
          name: "userId",
          type: "text",
          required: true,
        }),
      );

      collection.fields.add(
        new Field({ name: "createdAt", type: "number", required: true }),
      );
      collection.fields.add(
        new Field({ name: "updatedAt", type: "number", required: true }),
      );
      collection.fields.add(
        new Field({ name: "encryptedData", type: "text", required: true }),
      );
      collection.fields.add(
        new Field({ name: "encryptedDataIV", type: "text", required: true }),
      );
      collection.fields.add(new Field({ name: "isDeleted", type: "bool" }));

      if (extraFields) {
        for (const f of extraFields) {
          collection.fields.add(new Field(f));
        }
      }

      app.save(collection);

      // Add index for fast per-user sync queries using the client-authored LWW timestamp.
      try {
        app
          .db()
          .newQuery(
            `CREATE INDEX IF NOT EXISTS "idx_${name}_sync" ON "${name}" (userId, updatedAt)`,
          )
          .execute();
      } catch (_) {}
    }

    // ─── Standard Sync Tables ────────────────────────────────────────
    createSyncTable("characters");
    createSyncTable("settings");
    createSyncTable("personas");
    createSyncTable("modules");
    createSyncTable("plugins");
    createSyncTable("presets");
    createSyncTable("assets");
    createSyncTable("lorebooks");
    createSyncTable("scripts");
    createSyncTable("charjs");
    createSyncTable("chats");
    createSyncTable("messages");

    // ─── Asset Catalog ────────────────────────────────────────────────
    let catalogExists = false;
    try {
      catalogExists = !!app.findCollectionByNameOrId("assetCatalog");
    } catch (_) {}
    if (!catalogExists) {
      const catalogCollection = new Collection({
        name: "assetCatalog",
        type: "base",
      });

      catalogCollection.fields.add(
        new Field({ name: "hash", type: "text", required: true }),
      );
      catalogCollection.fields.add(
        new Field({
          name: "ownerId",
          type: "text",
          required: true,
        }),
      );
      catalogCollection.fields.add(
        new Field({ name: "kind", type: "text", required: true }),
      );
      catalogCollection.fields.add(
        new Field({ name: "size", type: "number", required: true }),
      );
      catalogCollection.fields.add(
        new Field({
          name: "refCount",
          type: "number",
          required: false,
          min: 0,
        }),
      );
      catalogCollection.fields.add(
        new Field({
          name: "file",
          type: "file",
          required: false,
          maxSelect: 1,
          maxSize: 10 * 1024 * 1024,
          mimeTypes: [
            "image/webp",
            "image/png",
            "image/jpeg",
            "application/octet-stream",
          ],
          protected: false,
        }),
      );

      app.save(catalogCollection);

      try {
        app
          .db()
          .newQuery(
            'CREATE UNIQUE INDEX IF NOT EXISTS "idx_assetCatalog_hash" ON "assetCatalog" (hash)',
          )
          .execute();
      } catch (_) {}
    }
  },
  (app) => {
    // DOWN MIGRATION (Rollback)

    // 1. Remove all created tables
    const tables = [
      "messages",
      "chats",
      "scripts",
      "charjs",
      "lorebooks",
      "assets",
      "presets",
      "plugins",
      "modules",
      "personas",
      "settings",
      "characters",
      "assetCatalog",
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
        "salt",
        "encryptedMasterKey",
        "masterKeyIv",
        "encryptedRecoveryMasterKey",
        "recoveryMasterKeyIv",
        "recoveryAuthTokenHash",
        "identityPublicKey",
        "encryptedIdentityPrivateKey",
        "identityPrivateKeyIv",
        "assetQuota",
        "assetUsage",
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
  },
);
