import Dexie from 'dexie';
import Database from '@tauri-apps/plugin-sql';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { Store as TauriStore } from '@tauri-apps/plugin-store';
import { UserWriteEventEmitter } from './events';
import { clock } from '$lib/utils/clock';
import type {
    IUserAdapter,
    UserRecord,
    UserWriteOptions,
    UserWriteEventListener,
    UserWriteOperation
} from './types';

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
            users: 'id, username, isDeleted, selfHostUrl, updatedAt'
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
    isDeleted: number; // 0 | 1
    selfHostUrl: string | null;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class TauriUserAdapter implements IUserAdapter {
    private readonly authDB = new UserDexie();
    private readonly writeEvents = new UserWriteEventEmitter();

    // Lazy singletons — initialised on first use
    private sqlitePromise: Promise<Database> | null = null;
    private strongholdPromise: Promise<Stronghold> | null = null;

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
					isDeleted INTEGER NOT NULL DEFAULT 0,
					selfHostUrl TEXT
				)
			`);
            await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_updatedAt ON users (updatedAt)`);
            return db;
        })();

        return this.sqlitePromise;
    }

    private async sqliteSave(user: UserRecord): Promise<void> {
        const db = await this.getSQLite();
        await db.execute(
            `INSERT OR REPLACE INTO users (id, userId, name, username, email, avatar, createdAt, updatedAt, isDeleted, selfHostUrl)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                user.id,
                user.id,
                user.name,
                user.username ?? null,
                user.email ?? null,
                user.avatar,
                user.createdAt,
                user.updatedAt,
                user.isDeleted ? 1 : 0,
                user.selfHostUrl ?? null
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
        return db.select<SQLiteUserRow[]>(`SELECT * FROM users WHERE isDeleted = 0`);
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
                vaultPassword = btoa(String.fromCharCode(...entropy));
                await metaStore.set('vaultPassword', vaultPassword);
                await metaStore.save();
            }

            const dataDir = await appLocalDataDir();
            return Stronghold.load(`${dataDir}/keiai.hold`, vaultPassword);
        })();

        return this.strongholdPromise;
    }

    private async getStore() {
        const stronghold = await this.getStronghold();
        // createClient is idempotent in Stronghold v2: returns existing client
        // if one was already created for this path.
        const client = await stronghold.createClient('KeiAI');
        return client.getStore();
    }

    // ── IUserAdapter ──────────────────────────────────────────────────────────

    async getUser(id: string): Promise<UserRecord | null> {
        // Primary: Dexie
        const user = await this.authDB.users.get(id);
        if (user && !user.isDeleted) return user;

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
        const users = await this.authDB.users.filter((u) => !u.isDeleted).toArray();
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
        // 1. Dexie — stores the live CryptoKey via Structured Clone
        await this.authDB.users.put(user);

        // 2. SQLite mirror — no masterKey
        await this.sqliteSave(user);

        // 3. Stronghold — backup raw bytes for durable local identity recovery.
        try {
            const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', user.masterKey));
            await this.backupMasterKey(user.id, rawKey);
            rawKey.fill(0); // scrub from memory after storing

            const pubJwk = await crypto.subtle.exportKey('jwk', user.identityKeyPair.publicKey);
            const privRaw = new Uint8Array(
                (await crypto.subtle.exportKey(
                    'pkcs8',
                    user.identityKeyPair.privateKey
                )) as ArrayBuffer
            );
            await this.backupIdentityKeys(user.id, pubJwk, privRaw);
            privRaw.fill(0);
        } catch {
            // Keep the IndexedDB copy if the platform refuses export.
        }

        this.emitWriteEvent('put', [user.id], options);
    }

    async deleteUser(id: string, options?: UserWriteOptions): Promise<void> {
        // Soft-delete in both stores
        const user = await this.getUser(id);
        if (!user) return;

        user.isDeleted = true;
        user.updatedAt = clock.now();

        await this.authDB.users.put(user);
        await this.sqliteSave(user);

        // Note: we intentionally leave the Stronghold entry intact.
        // The raw key is harmless without the user record and removal is
        // not required for correctness.
        this.emitWriteEvent('softDelete', [id], options);
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
            const data = (await store.get(`masterKey:${id}`)) as number[] | null;
            return data ? new Uint8Array(data) : null;
        } catch {
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
            const pubData = (await store.get(`identityPub:${id}`)) as number[] | null;
            const privData = (await store.get(`identityPriv:${id}`)) as number[] | null;
            if (!pubData || !privData) return null;

            const pubJson = new TextDecoder().decode(new Uint8Array(pubData));

            return {
                publicKeyJwk: JSON.parse(pubJson) as JsonWebKey,
                rawPrivateKey: new Uint8Array(privData)
            };
        } catch {
            return null;
        }
    }

    // ── Recovery helpers ──────────────────────────────────────────────────────

    private async recoverOne(id: string): Promise<UserRecord | null> {
        const row = await this.sqliteGetOne(id);
        if (!row || row.isDeleted) return null;
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
            // Stronghold entry missing — no way to reconstruct CryptoKeys
            return null;
        }

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
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            []
        );

        const privateKey = await crypto.subtle.importKey(
            'pkcs8',
            idKeys.rawPrivateKey.buffer as ArrayBuffer,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey']
        );

        return {
            id: row.id,
            name: row.name,
            username: row.username ?? undefined,
            email: row.email ?? undefined,
            avatar: row.avatar,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            isDeleted: row.isDeleted === 1,
            selfHostUrl: row.selfHostUrl ?? undefined,
            masterKey,
            identityKeyPair: { publicKey, privateKey }
        };
    }
}

export const tauriUser = new TauriUserAdapter();
