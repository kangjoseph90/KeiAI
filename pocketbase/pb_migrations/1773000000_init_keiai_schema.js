/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // ─── 1. Configure users collection ───────────────────────────────
    const users = app.findCollectionByNameOrId("_pb_users_auth_");

    // Make email optional
    const emailField = users.fields.getByName("email");
    if (emailField) {
      emailField.required = false;
    }

    // Add username field (PB v0.23+ removed it as a system field)
    users.fields.add(
      new Field({
        name: "username",
        type: "text",
        required: true,
        presentable: true,
      }),
    );

    // Add E2EE fields
    const userFields = [
      { name: "salt", type: "text" },
      { name: "encryptedMasterKey", type: "text" },
      { name: "masterKeyIv", type: "text" },
      { name: "encryptedRecoveryMasterKey", type: "text" },
      { name: "recoveryMasterKeyIv", type: "text" },
      { name: "recoveryAuthTokenHash", type: "text" },
      { name: "assetMaxBytes", type: "number" },
      { name: "assetUsedBytes", type: "number" },
      { name: "identityPublicKey", type: "text" },
      { name: "encryptedIdentityPrivateKey", type: "text" },
      { name: "identityPrivateKeyIv", type: "text" },
    ];

    for (const f of userFields) {
      users.fields.add(new Field({ name: f.name, type: f.type }));
    }

    // Persist fields first — identityFields validation needs them saved
    app.save(users);

    // Configure password auth with username identity
    const freshUsers = app.findCollectionByNameOrId("_pb_users_auth_");
    freshUsers.addIndex("idx_users_username_unique", true, "username", "");
    freshUsers.passwordAuth.enabled = true;
    freshUsers.passwordAuth.identityFields = ["username"];
    app.save(freshUsers);

    // ─── 2. Enable batch API ─────────────────────────────────────────
    const settings = app.settings();
    settings.batch.enabled = true;
    settings.batch.maxRequests = 100;
    settings.batch.timeout = 30;
    app.save(settings);

    // ─── 3. Create blind sync tables ─────────────────────────────────
    const authRule = "userId = @request.auth.id";

    function createSyncTable(name, extraFields) {
      const collection = new Collection({
        name: name,
        type: "base",
        listRule: authRule,
        viewRule: authRule,
        createRule: authRule,
        updateRule: authRule,
        deleteRule: authRule,
      });

      collection.fields.add(
        new Field({ name: "userId", type: "text", required: true }),
      );
      collection.fields.add(
        new Field({ name: "createdAt", type: "number", required: true }),
      );
      collection.fields.add(
        new Field({ name: "updatedAt", type: "number", required: true }),
      );
      for (const field of extraFields || []) {
        collection.fields.add(new Field(field));
      }
      collection.fields.add(
        new Field({ name: "encryptedData", type: "text", required: true }),
      );
      collection.fields.add(
        new Field({ name: "encryptedDataIV", type: "text", required: true }),
      );
      collection.fields.add(new Field({ name: "isDeleted", type: "bool" }));

      app.save(collection);

      app
        .db()
        .newQuery(
          `CREATE INDEX IF NOT EXISTS "idx_${name}_sync" ON "${name}" (userId, updatedAt)`,
        )
        .execute();
    }

    createSyncTable("characters");
    createSyncTable("settings");
    createSyncTable("personas");
    createSyncTable("modules");
    createSyncTable("plugins");
    createSyncTable("presets");
    createSyncTable("assets", [
      { name: "hash", type: "text", required: true },
      { name: "status", type: "text", required: true },
    ]);
    createSyncTable("lorebooks");
    createSyncTable("scripts");
    createSyncTable("charjs");
    createSyncTable("chats");
    createSyncTable("messages");
    createSyncTable("translations");

    // ─── 4. Asset catalog and usage ledger ───────────────────────────
    const catalog = new Collection({
      name: "asset_catalog",
      type: "base",
    });

    catalog.fields.add(
      new Field({ name: "hash", type: "text", required: true }),
    );
    catalog.fields.add(
      new Field({ name: "size", type: "number", required: true }),
    );
    catalog.fields.add(
      new Field({
        name: "data",
        type: "file",
        maxSelect: 1,
        maxSize: 10 * 1024 * 1024,
        mimeTypes: ["application/octet-stream"],
      }),
    );

    app.save(catalog);

    app
      .db()
      .newQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS "idx_asset_catalog_hash" ON "asset_catalog" (hash)',
      )
      .execute();

    const usage = new Collection({
      name: "asset_usage",
      type: "base",
    });

    usage.fields.add(
      new Field({ name: "userId", type: "text", required: true }),
    );
    usage.fields.add(new Field({ name: "hash", type: "text", required: true }));
    usage.fields.add(
      new Field({ name: "refCount", type: "number", required: true, min: 0 }),
    );
    usage.fields.add(
      new Field({ name: "size", type: "number", required: true }),
    );
    usage.fields.add(
      new Field({ name: "createdAt", type: "number", required: true }),
    );
    usage.fields.add(
      new Field({ name: "updatedAt", type: "number", required: true }),
    );

    app.save(usage);

    app
      .db()
      .newQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS "idx_asset_usage_user_hash" ON "asset_usage" (userId, hash)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_asset_usage_hash" ON "asset_usage" (hash)',
      )
      .execute();
  },
  (app) => {
    // DOWN — drop everything
    const tables = [
      "translations",
      "messages",
      "chats",
      "charjs",
      "scripts",
      "lorebooks",
      "assets",
      "presets",
      "plugins",
      "modules",
      "personas",
      "settings",
      "characters",
      "asset_usage",
      "asset_catalog",
    ];
    for (const name of tables) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {}
    }

    // Remove added fields from users
    try {
      const users = app.findCollectionByNameOrId("_pb_users_auth_");
      const fields = [
        "username",
        "salt",
        "encryptedMasterKey",
        "masterKeyIv",
        "encryptedRecoveryMasterKey",
        "recoveryMasterKeyIv",
        "recoveryAuthTokenHash",
        "identityPublicKey",
        "encryptedIdentityPrivateKey",
        "identityPrivateKeyIv",
        "assetMaxBytes",
        "assetUsedBytes",
      ];
      for (const f of fields) {
        try {
          const field = users.fields.getByName(f);
          if (field) users.fields.removeById(field.id);
        } catch (_) {}
      }
      app.save(users);
    } catch (_) {}
  },
);
