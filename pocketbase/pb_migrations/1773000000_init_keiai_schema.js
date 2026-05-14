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
    const userRule = "userId = @request.auth.id";
    const memberRule =
      '@request.auth.id != "" && @collection.multi_room_members.roomId ?= roomId && @collection.multi_room_members.userId ?= @request.auth.id && @collection.multi_room_members.status ?= "accepted" && @collection.multi_room_members.isDeleted ?= false';
    const memberMetaRule =
      '@request.auth.id != "" && @collection.multi_room_members.roomId ?= id && @collection.multi_room_members.userId ?= @request.auth.id && @collection.multi_room_members.isDeleted ?= false';
    const memberRowMetaRule =
      '@request.auth.id != "" && @collection.multi_room_members.roomId ?= roomId && @collection.multi_room_members.userId ?= @request.auth.id && @collection.multi_room_members.isDeleted ?= false';
    const ownerByRoomRule =
      '@request.auth.id != "" && @collection.multi_room_index.id ?= roomId && @collection.multi_room_index.ownerUserId ?= @request.auth.id && @collection.multi_room_index.isDeleted ?= false';

    function addEncryptedPayloadFields(collection) {
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
    }

    function createUserRecordTable(name, options) {
      const extraFields = (options && options.extraFields) || [];
      const includeKind = Boolean(options && options.includeKind);
      const collection = new Collection({
        name: name,
        type: "base",
        listRule: userRule,
        viewRule: userRule,
        createRule: userRule,
        updateRule: userRule,
        deleteRule: userRule,
      });

      collection.fields.add(
        new Field({ name: "userId", type: "text", required: true }),
      );
      if (includeKind) {
        collection.fields.add(
          new Field({ name: "kind", type: "text", required: true }),
        );
      }
      for (const field of extraFields || []) {
        collection.fields.add(new Field(field));
      }
      addEncryptedPayloadFields(collection);

      app.save(collection);

      app
        .db()
        .newQuery(
          `CREATE INDEX IF NOT EXISTS "idx_${name}_sync" ON "${name}" (userId, updatedAt)`,
        )
        .execute();
      if (includeKind) {
        app
          .db()
          .newQuery(
            `CREATE INDEX IF NOT EXISTS "idx_${name}_kind_sync" ON "${name}" (userId, kind, updatedAt)`,
          )
          .execute();
      }
    }

    function createRoomRecordTable(name, options) {
      const extraFields = (options && options.extraFields) || [];
      const includeKind = Boolean(options && options.includeKind);
      const collection = new Collection({
        name: name,
        type: "base",
        listRule: memberRule,
        viewRule: memberRule,
        createRule: memberRule,
        updateRule: memberRule,
        deleteRule: memberRule,
      });

      collection.fields.add(
        new Field({ name: "roomId", type: "text", required: true }),
      );
      if (includeKind) {
        collection.fields.add(
          new Field({ name: "kind", type: "text", required: true }),
        );
      }
      for (const field of extraFields || []) {
        collection.fields.add(new Field(field));
      }
      addEncryptedPayloadFields(collection);

      app.save(collection);

      app
        .db()
        .newQuery(
          `CREATE INDEX IF NOT EXISTS "idx_${name}_sync" ON "${name}" (roomId, updatedAt)`,
        )
        .execute();
      if (includeKind) {
        app
          .db()
          .newQuery(
            `CREATE INDEX IF NOT EXISTS "idx_${name}_kind_sync" ON "${name}" (roomId, kind, updatedAt)`,
          )
          .execute();
      }
    }

    createUserRecordTable("records", { includeKind: true });
    createUserRecordTable("assets", {
      extraFields: [
        { name: "hash", type: "text", required: true },
        { name: "status", type: "text", required: true },
      ],
    });

    // Room metadata stays plaintext enough for discovery, invitations, and key routing.
    const roomIndex = new Collection({
      name: "multi_room_index",
      type: "base",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: "ownerUserId = @request.auth.id",
      updateRule: "ownerUserId = @request.auth.id",
      deleteRule: "ownerUserId = @request.auth.id",
    });
    roomIndex.fields.add(
      new Field({ name: "ownerUserId", type: "text", required: true }),
    );
    roomIndex.fields.add(
      new Field({ name: "visibility", type: "text", required: true }),
    );
    roomIndex.fields.add(new Field({ name: "publicName", type: "text" }));
    roomIndex.fields.add(
      new Field({ name: "createdAt", type: "number", required: true }),
    );
    roomIndex.fields.add(
      new Field({ name: "updatedAt", type: "number", required: true }),
    );
    roomIndex.fields.add(new Field({ name: "isDeleted", type: "bool" }));
    app.save(roomIndex);

    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_index_owner" ON "multi_room_index" (ownerUserId, updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_index_public" ON "multi_room_index" (visibility, publicName)',
      )
      .execute();

    const members = new Collection({
      name: "multi_room_members",
      type: "base",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    members.fields.add(
      new Field({ name: "roomId", type: "text", required: true }),
    );
    members.fields.add(
      new Field({ name: "userId", type: "text", required: true }),
    );
    members.fields.add(
      new Field({ name: "status", type: "text", required: true }),
    );
    members.fields.add(new Field({ name: "encryptedRoomKey", type: "text" }));
    members.fields.add(
      new Field({ name: "createdAt", type: "number", required: true }),
    );
    members.fields.add(
      new Field({ name: "updatedAt", type: "number", required: true }),
    );
    members.fields.add(new Field({ name: "isDeleted", type: "bool" }));
    app.save(members);

    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_members_user" ON "multi_room_members" (userId, updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_members_room" ON "multi_room_members" (roomId, updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS "idx_multi_room_members_room_user" ON "multi_room_members" (roomId, userId)',
      )
      .execute();

    const freshRoomIndex = app.findCollectionByNameOrId("multi_room_index");
    freshRoomIndex.listRule = memberMetaRule;
    freshRoomIndex.viewRule = memberMetaRule;
    app.save(freshRoomIndex);

    const freshMembers = app.findCollectionByNameOrId("multi_room_members");
    freshMembers.listRule = memberRowMetaRule;
    freshMembers.viewRule = memberRowMetaRule;
    freshMembers.createRule = ownerByRoomRule;
    freshMembers.updateRule = ownerByRoomRule;
    freshMembers.deleteRule = ownerByRoomRule;
    app.save(freshMembers);

    createRoomRecordTable("multi_room_records", { includeKind: true });
    createRoomRecordTable("multi_room_assets", {
      extraFields: [
        { name: "hash", type: "text", required: true },
        { name: "status", type: "text", required: true },
      ],
    });

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
      "multi_room_assets",
      "multi_room_records",
      "multi_room_members",
      "multi_room_index",
      "assets",
      "records",
      "translations",
      "messages",
      "chats",
      "charjs",
      "scripts",
      "lorebooks",
      "presets",
      "plugins",
      "modules",
      "personas",
      "settings",
      "characters",
      "rooms",
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
