import Dexie from 'dexie';
import Database from '@tauri-apps/plugin-sql';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { Store as TauriStore } from '@tauri-apps/plugin-store';
import type { IUserAdapter, UserRecord } from './types';

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
 *               Stores the raw AES-256 bytes of guest master keys.
 *               Only guest keys are stored here because registered keys are
 *               non-extractable and therefore cannot be serialised.
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
 *   saveUser(guestUser) → adapter auto-exports raw key → stores in Stronghold
 *   No changes needed in session.ts or callers.
 */

// ─── Dexie Auth DB (identical to web.ts) ─────────────────────────────────────

class UserDexie extends Dexie {
	users!: Dexie.Table<UserRecord, string>;

	constructor() {
		super('KeiUsers'); // Same dedicated auth IndexedDB as the web adapter
		this.version(1).stores({
			users: 'id, isDeleted, isGuest, updatedAt'
		});
	}
}

// ─── SQLite row type (no masterKey) ──────────────────────────────────────────

interface SQLiteUserRow {
	id: string;
	userId: string;
	name: string;
	email: string | null;
	avatar: string;
	createdAt: number;
	updatedAt: number;
	isDeleted: number; // 0 | 1
	isGuest: number; // 0 | 1
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class TauriUserAdapter implements IUserAdapter {
	private readonly authDB = new UserDexie();

	// Lazy singletons — initialised on first use
	private sqlitePromise: Promise<Database> | null = null;
	private strongholdPromise: Promise<Stronghold> | null = null;

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
					email     TEXT,
					avatar    TEXT    NOT NULL,
					createdAt INTEGER NOT NULL,
					updatedAt INTEGER NOT NULL,
					isDeleted INTEGER NOT NULL DEFAULT 0,
					isGuest   INTEGER NOT NULL DEFAULT 0
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
			`INSERT OR REPLACE INTO users (id, userId, name, email, avatar, createdAt, updatedAt, isDeleted, isGuest)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				user.id,
				user.id,
				user.name,
				user.email ?? null,
				user.avatar,
				user.createdAt,
				user.updatedAt,
				user.isDeleted ? 1 : 0,
				user.isGuest ? 1 : 0
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

	async saveUser(user: UserRecord): Promise<void> {
		// 1. Dexie — stores the live CryptoKey via Structured Clone
		await this.authDB.users.put(user);

		// 2. SQLite mirror — no masterKey
		await this.sqliteSave(user);

		// 3. Stronghold — backup raw bytes for extractable (guest) keys.
		//    After registration, lockMasterKey() re-imports the same bytes as
		//    non-extractable and calls saveUser again with isGuest: false.
		//    We skip re-export there (impossible anyway), but the Stronghold
		//    entry written during the guest phase is still intact and sufficient
		//    for recovery of the registered user as well.
		if (user.isGuest) {
			try {
				const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', user.masterKey));
				await this.backupGuestKey(user.id, rawKey);
				rawKey.fill(0); // scrub from memory after storing
			} catch {
				// Key is non-extractable (should not happen for guests, but be safe)
			}
		}
	}

	async deleteUser(id: string): Promise<void> {
		// Soft-delete in both stores
		const user = await this.getUser(id);
		if (!user) return;

		user.isDeleted = true;
		user.updatedAt = Date.now();

		await this.authDB.users.put(user);
		await this.sqliteSave(user);

		// Note: we intentionally leave the Stronghold entry intact.
		// The raw key is harmless without the user record and removal is
		// not required for correctness.
	}

	async backupGuestKey(id: string, rawKey: Uint8Array): Promise<void> {
		const store = await this.getStore();
		const stronghold = await this.getStronghold();
		await store.insert(`guestKey:${id}`, Array.from(rawKey));
		await stronghold.save();
	}

	async restoreGuestKey(id: string): Promise<Uint8Array | null> {
		try {
			const store = await this.getStore();
			const data = await store.get(`guestKey:${id}`);
			return data ?? null;
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
	 *   - Guest → Register on this device: backed up during guest phase in saveUser()
	 *   - First login on this device: auth.ts login() calls backupGuestKey(serverUserId, rawM)
	 *     explicitly BEFORE scrubbing rawM, covering this case.
	 *   - recoverPassword(): delegates to login() internally → same coverage.
	 *
	 * The only unrecoverable case is if the Stronghold entry itself is missing
	 * (e.g. process killed mid-login before backupGuestKey completed), in which
	 * case we return null and let the session fall through to re-authentication.
	 */
	private async rebuildFromRow(row: SQLiteUserRow): Promise<UserRecord | null> {
		const rawKey = await this.restoreGuestKey(row.id);
		if (!rawKey) {
			// Stronghold entry missing — no way to reconstruct the CryptoKey
			return null;
		}

		const extractable = row.isGuest === 1;
		const masterKey = await crypto.subtle.importKey(
			'raw',
			rawKey.buffer as ArrayBuffer,
			{ name: 'AES-GCM' },
			extractable,
			['encrypt', 'decrypt']
		);

		return {
			id: row.id,
			name: row.name,
			email: row.email ?? undefined,
			avatar: row.avatar,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			isDeleted: row.isDeleted === 1,
			isGuest: row.isGuest === 1,
			masterKey
		};
	}
}

export const tauriUser = new TauriUserAdapter();
