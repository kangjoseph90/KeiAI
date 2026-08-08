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
      { name: "identityPublicKey", type: "text" },
      { name: "encryptedIdentityPrivateKey", type: "text" },
      { name: "identityPrivateKeyIv", type: "text" },
      {
        name: "encryptedProfile",
        type: "text",
        required: true,
        max: 10 * 1024 * 1024,
      },
      { name: "encryptedProfileIV", type: "text", required: true },
    ];

    for (const f of userFields) {
      users.fields.add(new Field(f));
    }

    // Persist fields first — identityFields validation needs them saved
    app.save(users);

    // Configure password auth with username identity
    const freshUsers = app.findCollectionByNameOrId("_pb_users_auth_");
    freshUsers.addIndex("idx_users_username_unique", true, "username", "");
    freshUsers.addIndex(
      "idx_users_recovery_auth_token_hash",
      false,
      "recoveryAuthTokenHash",
      "",
    );
    freshUsers.passwordAuth.enabled = true;
    freshUsers.passwordAuth.identityFields = ["username"];
    freshUsers.authToken.duration = 90 * 24 * 60 * 60;
    app.save(freshUsers);

    // ─── 2. Enable batch API ─────────────────────────────────────────
    const settings = app.settings();
    settings.batch.enabled = true;
    settings.batch.maxRequests = 100;
    settings.batch.timeout = 30;
    app.save(settings);

    // ─── 3. Create blind sync tables ─────────────────────────────────
    const userRule = "userId = @request.auth.id";
    const activeMemberRule =
      '@request.auth.id != "" && @collection.multi_room_index.id ?= roomId && @collection.multi_room_index.isDeleted ?= false && @collection.multi_room_members.roomId ?= roomId && @collection.multi_room_members.userId ?= @request.auth.id && @collection.multi_room_members.status ?= "accepted"';
    const memberMetaRule =
      '@request.auth.id != "" && @collection.multi_room_members.roomId ?= id && @collection.multi_room_members.userId ?= @request.auth.id';
    const memberRowMetaRule =
      '@request.auth.id != "" && (userId = @request.auth.id || @collection.multi_room_index.id ?= roomId && @collection.multi_room_index.ownerUserId ?= @request.auth.id || @collection.multi_room_members.roomId ?= roomId && @collection.multi_room_members.userId ?= @request.auth.id && @collection.multi_room_members.status ?= "accepted")';
    const ownerByRoomRule =
      '@request.auth.id != "" && @collection.multi_room_index.id ?= roomId && @collection.multi_room_index.ownerUserId ?= @request.auth.id && @collection.multi_room_index.isDeleted ?= false';
    const ownerSelfMemberCreateRule =
      '@request.auth.id != "" && userId = @request.auth.id && status = "accepted" && @collection.multi_room_index.id ?= roomId && @collection.multi_room_index.ownerUserId ?= @request.auth.id && @collection.multi_room_index.isDeleted ?= false';
    const encryptedPayloadMaxChars = 10 * 1024 * 1024;

    function addEncryptedPayloadFields(collection) {
      collection.fields.add(
        new Field({ name: "createdAt", type: "number", required: true }),
      );
      collection.fields.add(
        new Field({ name: "updatedAt", type: "number", required: true }),
      );
      collection.fields.add(
        new Field({ name: "serverUpdatedAt", type: "number", required: true }),
      );
      collection.fields.add(
        new Field({
          name: "encryptedData",
          type: "text",
          required: true,
          max: encryptedPayloadMaxChars,
        }),
      );
      collection.fields.add(
        new Field({ name: "encryptedDataIV", type: "text", required: true }),
      );
      collection.fields.add(new Field({ name: "isDeleted", type: "bool" }));
      collection.fields.add(
        new Field({
          name: "assetEntries",
          type: "text",
          max: 1024 * 1024,
        }),
      );
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
      app
        .db()
        .newQuery(
          `CREATE INDEX IF NOT EXISTS "idx_${name}_server_sync" ON "${name}" (userId, serverUpdatedAt)`,
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
        listRule: activeMemberRule,
        viewRule: activeMemberRule,
        createRule: activeMemberRule,
        updateRule: activeMemberRule,
        deleteRule: activeMemberRule,
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
      app
        .db()
        .newQuery(
          `CREATE INDEX IF NOT EXISTS "idx_${name}_server_sync" ON "${name}" (roomId, serverUpdatedAt)`,
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
    roomIndex.fields.add(
      new Field({ name: "serverUpdatedAt", type: "number", required: true }),
    );
    roomIndex.fields.add(new Field({ name: "isDeleted", type: "bool" }));
    app.save(roomIndex);

    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_index_owner" ON "multi_room_index" (ownerUserId, isDeleted, updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_index_public" ON "multi_room_index" (visibility, isDeleted, updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_index_updated" ON "multi_room_index" (updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_index_server_updated" ON "multi_room_index" (serverUpdatedAt)',
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
    members.fields.add(
      new Field({ name: "serverUpdatedAt", type: "number", required: true }),
    );
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
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_members_updated" ON "multi_room_members" (updatedAt)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_multi_room_members_server_updated" ON "multi_room_members" (serverUpdatedAt)',
      )
      .execute();
    const freshRoomIndex = app.findCollectionByNameOrId("multi_room_index");
    freshRoomIndex.listRule = memberMetaRule;
    freshRoomIndex.viewRule = memberMetaRule;
    app.save(freshRoomIndex);

    const freshMembers = app.findCollectionByNameOrId("multi_room_members");
    freshMembers.listRule = memberRowMetaRule;
    freshMembers.viewRule = memberRowMetaRule;
    freshMembers.createRule = ownerSelfMemberCreateRule;
    freshMembers.updateRule = ownerByRoomRule;
    freshMembers.deleteRule = ownerByRoomRule;
    app.save(freshMembers);

    createRoomRecordTable("multi_room_records", { includeKind: true });

    // ─── 4. Asset catalog and usage ledger ───────────────────────────
    const catalog = new Collection({
      name: "asset_catalog",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
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
      }),
    );
    catalog.fields.add(new Field({ name: "recoveryProtected", type: "bool" }));
    catalog.fields.add(
      new Field({ name: "createdAt", type: "number", required: true }),
    );

    app.save(catalog);

    app
      .db()
      .newQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS "idx_asset_catalog_hash" ON "asset_catalog" (hash)',
      )
      .execute();
    app
      .db()
      .newQuery(
        'CREATE INDEX IF NOT EXISTS "idx_asset_catalog_created" ON "asset_catalog" (createdAt)',
      )
      .execute();

    const usage = new Collection({
      name: "asset_usage",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    usage.fields.add(
      new Field({ name: "userId", type: "text", required: true }),
    );
    usage.fields.add(new Field({ name: "hash", type: "text", required: true }));
    usage.fields.add(
      new Field({ name: "refCount", type: "number", required: true, min: 0 }),
    );
    usage.fields.add(new Field({ name: "size", type: "number" }));
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

    const accounts = new Collection({
      name: "asset_accounts",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    accounts.fields.add(
      new Field({ name: "userId", type: "text", required: true }),
    );
    accounts.fields.add(
      new Field({ name: "usedBytes", type: "number", min: 0 }),
    );
    accounts.fields.add(new Field({ name: "maxBytes", type: "number" }));
    accounts.fields.add(
      new Field({ name: "createdAt", type: "number", required: true }),
    );
    accounts.fields.add(
      new Field({ name: "updatedAt", type: "number", required: true }),
    );

    app.save(accounts);

    app
      .db()
      .newQuery(
        'CREATE UNIQUE INDEX IF NOT EXISTS "idx_asset_accounts_user" ON "asset_accounts" (userId)',
      )
      .execute();
  },
  (app) => {
    // DOWN — drop everything
    const tables = [
      "multi_room_records",
      "multi_room_members",
      "multi_room_index",
      "records",
      "asset_accounts",
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
        "encryptedProfile",
        "encryptedProfileIV",
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
