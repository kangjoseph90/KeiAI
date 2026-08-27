import Dexie from 'dexie';
import Database from '@tauri-apps/plugin-sql';
import { Store as StrongholdStore, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { Store as TauriStore } from '@tauri-apps/plugin-store';
import { createLogger } from '$lib/adapters/logger';
import { toBase64 } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { UserWriteEventEmitter } from './events';
import type {
    IUserAdapter,
    UserRecord,
    UserWriteOptions,
    UserWriteEventListener,
    UserWriteOperation
} from './types';
import type { UserConnectionSettings } from '$lib/types/connections';

const logger = createLogger('adapter:user:tauri');

/**
 * Tauri User Adapter
 *
 * Dual-storage architecture for resilient user/key management on Tauri:
 *
 *   Primary   → Dexie (IndexedDB "KeiAIAuth")
 *               Identical to the Web adapter. Stores the full UserRecord
 *               including the live CryptoKey via IndexedDB Structured Clone.
 *
 *   Mirror    → SQLite ("KeiLocalDB.db", `users` table)
 *               Same row data as Dexie MINUS the masterKey.
 *               Survives WebView cache clears that would wipe IndexedDB.
 *
 *   Key store → Stronghold ("keiai.hold")
 *               Stores the raw AES-256 bytes of the user's local master key.
 *               The vault password is auto-generated once and persisted in
 *               the Tauri plugin-store ("auth-meta.json").
 *
 * Recovery flow (when Dexie/IndexedDB is wiped):
 *   getUser / getAllUsers → Dexie returns nothing
 *   → query SQLite for row(s)
 *   → fetch raw key bytes from Stronghold
 *   → reconstruct CryptoKey via crypto.subtle.importKey
 *   → re-populate Dexie transparently
 *
 * Key backup flow:
 *   saveUser(user) → adapter auto-exports raw key → stores in Stronghold
 *   No changes needed in session.ts or callers.
 */

// ─── Dexie Auth DB (identical to web.ts) ─────────────────────────────────────

class UserDexie extends Dexie {
    users!: Dexie.Table<UserRecord, string>;

    constructor() {
        super('KeiUsers'); // Same dedicated auth IndexedDB as the web adapter
        this.version(1).stores({
            users: 'id, username, updatedAt'
        });
    }
}

// ─── SQLite row type (no masterKey) ──────────────────────────────────────────

interface SQLiteUserRow {
    id: string;
    userId: string;
    name: string;
    username: string | null;
    email: string | null;
    avatar: string;
    createdAt: number;
    updatedAt: number;
    connections: string;
}

interface SecureKeySnapshot {
    masterKey: Uint8Array | null;
    identityPublic: Uint8Array | null;
    identityPrivate: Uint8Array | null;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class TauriUserAdapter implements IUserAdapter {
    private readonly authDB = new UserDexie();
    private readonly writeEvents = new UserWriteEventEmitter();

    // Lazy singletons — initialised on first use
    private sqlitePromise: Promise<Database> | null = null;
    private strongholdPromise: Promise<Stronghold> | null = null;
    private strongholdStorePromise: Promise<StrongholdStore> | null = null;

    subscribeWriteEvents(listener: UserWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    private emitWriteEvent(
        operation: UserWriteOperation,
        ids: string[],
        options?: UserWriteOptions
    ): void {
        this.writeEvents.emit({
            tableName: 'users',
            operation,
            ids,
            origin: options?.origin ?? 'local'
        });
    }

    // ── SQLite ────────────────────────────────────────────────────────────────

    private async getSQLite(): Promise<Database> {
        if (this.sqlitePromise) return this.sqlitePromise;

        this.sqlitePromise = (async () => {
            // Re-use the same DB file as the main TauriDatabaseAdapter so we
            // don't need an extra file, but the `users` table is ours alone.
            const db = await Database.load('sqlite:KeiLocalDB.db');
            await db.execute(`
				CREATE TABLE IF NOT EXISTS users (
					id        TEXT    PRIMARY KEY,
					userId    TEXT    NOT NULL,
					name      TEXT    NOT NULL,
					username  TEXT,
					email     TEXT,
					avatar    TEXT    NOT NULL,
					createdAt INTEGER NOT NULL,
					updatedAt INTEGER NOT NULL,
					connections TEXT NOT NULL
				)
			`);
            await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_updatedAt ON users (updatedAt)`);
            return db;
        })();

        return this.sqlitePromise;
    }

    private async sqliteSave(user: UserRecord): Promise<void> {
        await this.sqliteSaveRow({
            id: user.id,
            userId: user.id,
            name: user.name,
            username: user.username ?? null,
            email: user.email ?? null,
            avatar: user.avatar,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            connections: JSON.stringify(user.connections)
        });
    }

    private async sqliteSaveRow(row: SQLiteUserRow): Promise<void> {
        const db = await this.getSQLite();
        await db.execute(
            `INSERT OR REPLACE INTO users (id, userId, name, username, email, avatar, createdAt, updatedAt, connections)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                row.id,
                row.userId,
                row.name,
                row.username,
                row.email,
                row.avatar,
                row.createdAt,
                row.updatedAt,
                row.connections
            ]
        );
    }

    private async sqliteGetOne(id: string): Promise<SQLiteUserRow | null> {
        const db = await this.getSQLite();
        const rows = await db.select<SQLiteUserRow[]>(`SELECT * FROM users WHERE id = $1`, [id]);
        return rows[0] ?? null;
    }

    private async sqliteGetAll(): Promise<SQLiteUserRow[]> {
        const db = await this.getSQLite();
        return db.select<SQLiteUserRow[]>(`SELECT * FROM users`);
    }

    // ── Stronghold (key store) ────────────────────────────────────────────────

    private async getStronghold(): Promise<Stronghold> {
        if (this.strongholdPromise) return this.strongholdPromise;

        this.strongholdPromise = (async () => {
            // The vault password is generated once and stored in the Tauri
            // plugin-store (OS AppData).  This means the keychain survives
            // WebView cache clears.  auth-meta.json is persisted by the same
            // mechanism as settings.json in TauriKeyValueAdapter.
            const metaStore = await TauriStore.load('auth-meta.json');

            let vaultPassword = await metaStore.get<string>('vaultPassword');
            if (!vaultPassword) {
                const entropy = crypto.getRandomValues(new Uint8Array(32));
                vaultPassword = toBase64(entropy);
                await metaStore.set('vaultPassword', vaultPassword);
                await metaStore.save();
            }

            const dataDir = await appLocalDataDir();
            return Stronghold.load(`${dataDir}/keiai.hold`, vaultPassword);
        })();

        return this.strongholdPromise;
    }

    private async getStore(): Promise<StrongholdStore> {
        if (this.strongholdStorePromise) return this.strongholdStorePromise;

        this.strongholdStorePromise = (async () => {
            const stronghold = await this.getStronghold();
            try {
                return (await stronghold.loadClient('KeiAI')).getStore();
            } catch {
                return (await stronghold.createClient('KeiAI')).getStore();
            }
        })().catch((error: unknown) => {
            this.strongholdStorePromise = null;
            throw error;
        });

        return this.strongholdStorePromise;
    }

    // ── IUserAdapter ──────────────────────────────────────────────────────────

    async getUser(id: string): Promise<UserRecord | null> {
        // Primary: Dexie
        const user = await this.authDB.users.get(id);
        if (user) return user;

        // Recovery: SQLite + Stronghold
        const recovered = await this.recoverOne(id);
        if (recovered) {
            // Silently restore to Dexie so subsequent calls are fast
            await this.authDB.users.put(recovered);
        }
        return recovered;
    }

    async getAllUsers(): Promise<UserRecord[]> {
        // Primary: Dexie
        const users = await this.authDB.users.toArray();
        if (users.length > 0) return users;

        // Recovery: SQLite + Stronghold
        const rows = await this.sqliteGetAll();
        const recovered: UserRecord[] = [];
        for (const row of rows) {
            const user = await this.rebuildFromRow(row);
            if (user) recovered.push(user);
        }

        // Silently re-populate Dexie
        if (recovered.length > 0) {
            await this.authDB.users.bulkPut(recovered);
        }
        return recovered;
    }

    async saveUser(user: UserRecord, options?: UserWriteOptions): Promise<void> {
        let rawKey: Uint8Array | null = null;
        let privateKeyBytes: Uint8Array | null = null;
        let secureSnapshot: SecureKeySnapshot | null = null;
        let previousDexie: UserRecord | undefined;
        let previousSQLite: SQLiteUserRow | null = null;
        let writesStarted = false;

        try {
            rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', user.masterKey));
            const pubJwk = await crypto.subtle.exportKey('jwk', user.identityKeyPair.publicKey);
            privateKeyBytes = new Uint8Array(
                (await crypto.subtle.exportKey(
                    'pkcs8',
                    user.identityKeyPair.privateKey
                )) as ArrayBuffer
            );

            [previousDexie, previousSQLite, secureSnapshot] = await Promise.all([
                this.authDB.users.get(user.id),
                this.sqliteGetOne(user.id),
                this.snapshotSecureKeys(user.id)
            ]);

            writesStarted = true;
            await this.writeSecureKeys(user.id, rawKey, pubJwk, privateKeyBytes);
            await this.authDB.users.put(user);
            await this.sqliteSave(user);
        } catch (error) {
            const rollbackErrors =
                writesStarted && secureSnapshot
                    ? await this.restoreUserState(
                          user.id,
                          previousDexie,
                          previousSQLite,
                          secureSnapshot
                      )
                    : [];

            logger.error(`Failed to durably save local user ${user.id}`, error);
            if (rollbackErrors.length > 0) {
                logger.error(`Failed to fully roll back local user ${user.id}`, rollbackErrors);
            }
            throw new AppError(
                'USER_ADAPTER_ERROR',
                rollbackErrors.length > 0
                    ? 'Local identity save failed and the previous identity could not be fully restored. Restart the app before retrying.'
                    : 'Secure local identity save failed. The previous identity was restored; retry after checking app storage access.',
                { error, rollbackErrors }
            );
        } finally {
            rawKey?.fill(0);
            privateKeyBytes?.fill(0);
            scrubSecureSnapshot(secureSnapshot);
        }

        this.emitWriteEvent('put', [user.id], options);
    }

    async deleteUser(id: string, options?: UserWriteOptions): Promise<void> {
        const [previousDexie, previousSQLite, secureSnapshot] = await Promise.all([
            this.authDB.users.get(id),
            this.sqliteGetOne(id),
            this.snapshotSecureKeys(id)
        ]);

        try {
            const db = await this.getSQLite();
            await this.authDB.users.delete(id);
            await db.execute(`DELETE FROM users WHERE id = $1`, [id]);
            await this.deleteSecureKeys(id);
        } catch (error) {
            const rollbackErrors = await this.restoreUserState(
                id,
                previousDexie,
                previousSQLite,
                secureSnapshot
            );
            throw new AppError(
                'USER_ADAPTER_ERROR',
                rollbackErrors.length > 0
                    ? 'Local user deletion failed and could not be fully rolled back. Restart the app before retrying.'
                    : 'Local user deletion failed. No local identity data was removed.',
                { error, rollbackErrors }
            );
        } finally {
            scrubSecureSnapshot(secureSnapshot);
        }

        this.emitWriteEvent('purge', [id], options);
    }

    async backupMasterKey(id: string, rawKey: Uint8Array): Promise<void> {
        const store = await this.getStore();
        const stronghold = await this.getStronghold();
        await store.insert(`masterKey:${id}`, Array.from(rawKey));
        await stronghold.save();
    }

    async restoreMasterKey(id: string): Promise<Uint8Array | null> {
        try {
            const store = await this.getStore();
            const data = await store.get(`masterKey:${id}`);
            return data ? new Uint8Array(data) : null;
        } catch (error) {
            logger.warn(`Failed to restore master key for local user ${id}`, error);
            return null;
        }
    }

    async backupIdentityKeys(
        id: string,
        publicKeyJwk: JsonWebKey,
        rawPrivateKey: Uint8Array
    ): Promise<void> {
        const store = await this.getStore();
        const stronghold = await this.getStronghold();
        const pubBytes = Array.from(new TextEncoder().encode(JSON.stringify(publicKeyJwk)));
        await store.insert(`identityPub:${id}`, pubBytes);
        await store.insert(`identityPriv:${id}`, Array.from(rawPrivateKey));
        await stronghold.save();
    }

    async restoreIdentityKeys(
        id: string
    ): Promise<{ publicKeyJwk: JsonWebKey; rawPrivateKey: Uint8Array } | null> {
        try {
            const store = await this.getStore();
            const pubData = await store.get(`identityPub:${id}`);
            const privData = await store.get(`identityPriv:${id}`);
            if (!pubData || !privData) return null;

            const pubJson = new TextDecoder().decode(new Uint8Array(pubData));

            return {
                publicKeyJwk: JSON.parse(pubJson) as JsonWebKey,
                rawPrivateKey: new Uint8Array(privData)
            };
        } catch (error) {
            logger.warn(`Failed to restore identity keys for local user ${id}`, error);
            return null;
        }
    }

    private async snapshotSecureKeys(id: string): Promise<SecureKeySnapshot> {
        const store = await this.getStore();
        const [masterKey, identityPublic, identityPrivate] = await Promise.all([
            store.get(`masterKey:${id}`),
            store.get(`identityPub:${id}`),
            store.get(`identityPriv:${id}`)
        ]);
        return {
            masterKey: masterKey ? new Uint8Array(masterKey) : null,
            identityPublic: identityPublic ? new Uint8Array(identityPublic) : null,
            identityPrivate: identityPrivate ? new Uint8Array(identityPrivate) : null
        };
    }

    private async writeSecureKeys(
        id: string,
        rawKey: Uint8Array,
        publicKeyJwk: JsonWebKey,
        rawPrivateKey: Uint8Array
    ): Promise<void> {
        const store = await this.getStore();
        const stronghold = await this.getStronghold();
        const publicBytes = new TextEncoder().encode(JSON.stringify(publicKeyJwk));
        await store.insert(`masterKey:${id}`, Array.from(rawKey));
        await store.insert(`identityPub:${id}`, Array.from(publicBytes));
        await store.insert(`identityPriv:${id}`, Array.from(rawPrivateKey));
        await stronghold.save();
    }

    private async deleteSecureKeys(id: string): Promise<void> {
        const store = await this.getStore();
        const stronghold = await this.getStronghold();
        await store.remove(`masterKey:${id}`);
        await store.remove(`identityPub:${id}`);
        await store.remove(`identityPriv:${id}`);
        await stronghold.save();
    }

    private async restoreSecureKeys(id: string, snapshot: SecureKeySnapshot): Promise<void> {
        const store = await this.getStore();
        const stronghold = await this.getStronghold();
        await restoreStrongholdValue(store, `masterKey:${id}`, snapshot.masterKey);
        await restoreStrongholdValue(store, `identityPub:${id}`, snapshot.identityPublic);
        await restoreStrongholdValue(store, `identityPriv:${id}`, snapshot.identityPrivate);
        await stronghold.save();
    }

    private async restoreUserState(
        id: string,
        previousDexie: UserRecord | undefined,
        previousSQLite: SQLiteUserRow | null,
        secureSnapshot: SecureKeySnapshot
    ): Promise<unknown[]> {
        const rollbackErrors: unknown[] = [];
        const attempts = [
            async () => {
                if (previousDexie) await this.authDB.users.put(previousDexie);
                else await this.authDB.users.delete(id);
            },
            async () => {
                if (previousSQLite) await this.sqliteSaveRow(previousSQLite);
                else {
                    const db = await this.getSQLite();
                    await db.execute(`DELETE FROM users WHERE id = $1`, [id]);
                }
            },
            async () => this.restoreSecureKeys(id, secureSnapshot)
        ];

        for (const attempt of attempts) {
            try {
                await attempt();
            } catch (error) {
                rollbackErrors.push(error);
            }
        }
        return rollbackErrors;
    }

    // ── Recovery helpers ──────────────────────────────────────────────────────

    private async recoverOne(id: string): Promise<UserRecord | null> {
        const row = await this.sqliteGetOne(id);
        if (!row) return null;
        return this.rebuildFromRow(row);
    }

    /**
     * Reconstruct a full UserRecord from a SQLite row + Stronghold.
     *
     * Stronghold entry coverage:
     * The only unrecoverable case is if the Stronghold entry itself is missing,
     * in which case we return null and let the session fall through to recovery.
     */
    private async rebuildFromRow(row: SQLiteUserRow): Promise<UserRecord | null> {
        const rawKey = await this.restoreMasterKey(row.id);
        const idKeys = await this.restoreIdentityKeys(row.id);

        if (!rawKey || !idKeys) {
            rawKey?.fill(0);
            idKeys?.rawPrivateKey.fill(0);
            // Stronghold entry missing — no way to reconstruct CryptoKeys
            return null;
        }

        try {
            const masterKey = await crypto.subtle.importKey(
                'raw',
                rawKey.buffer as ArrayBuffer,
                { name: 'AES-GCM' },
                true,
                ['encrypt', 'decrypt']
            );

            const publicKey = await crypto.subtle.importKey(
                'jwk',
                idKeys.publicKeyJwk,
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                true,
                ['encrypt']
            );

            const privateKey = await crypto.subtle.importKey(
                'pkcs8',
                idKeys.rawPrivateKey.buffer as ArrayBuffer,
                { name: 'RSA-OAEP', hash: 'SHA-256' },
                true,
                ['decrypt']
            );

            return {
                id: row.id,
                name: row.name,
                username: row.username ?? undefined,
                email: row.email ?? undefined,
                avatar: row.avatar,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                connections: JSON.parse(row.connections) as UserConnectionSettings,
                masterKey,
                identityKeyPair: { publicKey, privateKey }
            };
        } finally {
            rawKey.fill(0);
            idKeys.rawPrivateKey.fill(0);
        }
    }
}

async function restoreStrongholdValue(
    store: StrongholdStore,
    key: string,
    value: Uint8Array | null
): Promise<void> {
    if (value) {
        await store.insert(key, Array.from(value));
    } else {
        await store.remove(key);
    }
}

function scrubSecureSnapshot(snapshot: SecureKeySnapshot | null): void {
    snapshot?.masterKey?.fill(0);
    snapshot?.identityPublic?.fill(0);
    snapshot?.identityPrivate?.fill(0);
}
