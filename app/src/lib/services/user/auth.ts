/**
 * Auth API — PB authentication + E2EE crypto flows.
 *
 * Pure service: talks to PocketBase, performs crypto operations, and delegates
 * local user record management to UserService. Does NOT touch Svelte stores —
 * post-auth store refresh is handled by store-level action functions in stores/auth.ts.
 *
 * Master key extractability lifecycle:
 *   Guest  (extractable: true)  → register() → Registered (extractable: false)
 *   Registered (extractable: false) → unlinkAccount() → Guest (extractable: true)
 */

import { pb } from '$lib/adapters/pb';
import {
	generateSalt,
	deriveKeys,
	wrapMasterKey,
	unwrapMasterKeyRaw,
	importMasterKey,
	createRecoveryData,
	deriveRecoveryKey,
	hashRecoveryAuthToken,
	splitRecoveryCode,
	toBase64,
	fromBase64,
	type RecoveryBundle
} from '$lib/crypto';
import { getActiveSession } from '../session';
import { UserService } from './user';
import { appUser } from '$lib/adapters/user';
import { DataSyncService, SyncManager } from '../sync';
import { AppError } from '$lib/shared/errors';

export class AuthService {
	// ─── PB Connection Helpers ────────────────────────────────────────

	/** Whether PocketBase currently holds a valid auth token. */
	static isPbConnected(): boolean {
		return pb.authStore.isValid;
	}

	/** Subscribe to PB auth state changes (token valid/invalid). */
	static onPbAuthChange(callback: (isValid: boolean) => void): void {
		pb.authStore.onChange(() => callback(pb.authStore.isValid));
	}
	/** Clear the PocketBase auth token. Safe to call when no session exists. */
	static clearAuth(): void {
		pb.authStore.clear();
	}
	// ─── Auth Flows ─────────────────────────────────────────────────

	/**
	 * Register: Link current guest account to a new server account.
	 * Returns the 16-char recovery code that UI must force user to save.
	 */
	static async register(email: string, password: string): Promise<string> {
		const { userId, masterKey, isGuest } = getActiveSession();
		if (!isGuest) {
			throw new AppError(
				'ALREADY_REGISTERED',
				'Already registered. Unlink your account to revert to guest mode.'
			);
		}

		const salt = await generateSalt();
		const { loginKey, encryptionKey } = await deriveKeys(password, salt);

		const wrapped = await wrapMasterKey(masterKey, encryptionKey);
		const recovery = await createRecoveryData(masterKey);
		encryptionKey.fill(0);

		const existing = await appUser.getUser(userId);

		const createData: Record<string, string | Blob> = {
			id: userId,
			name: existing?.name ?? 'Guest User',
			email,
			password: toBase64(loginKey),
			passwordConfirm: toBase64(loginKey),
			salt: toBase64(salt),
			encryptedMasterKey: toBase64(wrapped.ciphertext),
			masterKeyIv: toBase64(wrapped.iv),
			encryptedRecoveryMasterKey: toBase64(recovery.encryptedRecoveryMasterKey),
			recoveryMasterKeyIv: toBase64(recovery.encryptedRecoveryMasterKeyIV),
			recoveryAuthTokenHash: toBase64(recovery.recoveryAuthTokenHash)
		};

		if (existing?.avatar?.startsWith('data:image')) {
			try {
				const fetchResponse = await fetch(existing.avatar);
				createData.avatar = await fetchResponse.blob();
			} catch (e) {
				console.warn('Failed to parse local avatar for PB upload', e);
			}
		}

		await pb.collection('users').create(createData);

		// Login to initialize the registered session (lock master key etc.)
		await this.login(email, password);

		return recovery.recoveryCode.fullCode;
	}

	/**
	 * Login: Single-call E2EE login.
	 * Fetches salt → derives X,Y → auths with X → unwraps M(Y) → saves local user.
	 * Does NOT trigger store refresh — that's the caller's job (stores/auth.ts).
	 */
	static async login(email: string, password: string): Promise<void> {
		const { salt } = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const saltBytes = fromBase64(salt);
		const { loginKey, encryptionKey } = await deriveKeys(password, saltBytes);

		const authData = await pb.collection('users').authWithPassword(email, toBase64(loginKey));

		const rawM = await unwrapMasterKeyRaw(
			fromBase64(authData.record.encryptedMasterKey),
			fromBase64(authData.record.masterKeyIv),
			encryptionKey
		);

		let lockedKey: CryptoKey;
		try {
			lockedKey = await importMasterKey(rawM, false);
			await appUser.backupGuestKey(authData.record.id, rawM); // no-op on web
		} finally {
			rawM.fill(0);
		}

		let pbAvatarUrl: string | undefined;
		if (authData.record?.avatar) {
			pbAvatarUrl = pb.files.getURL(authData.record, authData.record.avatar);
		}

		await UserService.saveLoginUser({
			id: authData.record.id,
			email,
			masterKey: lockedKey,
			serverName: authData.record?.name,
			avatarUrl: pbAvatarUrl
		});

		// Always reset sync cursors on explicit login so the next syncAll()
		// performs a full pull. Login is rare (once per device session) and
		// this guarantees a clean slate — "re-login to fix sync issues" works.
		await DataSyncService.resetCursors(authData.record.id);
	}

	/**
	 * Recover password using the 16-char analog recovery code.
	 * Returns the NEW recovery code that replaces the old one.
	 */
	static async recoverPassword(
		email: string,
		recoveryCode: string,
		newPassword: string
	): Promise<string> {
		const resp = await pb.send(`/api/recovery-bundle/${encodeURIComponent(email)}`, {
			method: 'GET'
		});
		const bundle: RecoveryBundle = {
			encryptedRecoveryMasterKey: fromBase64(resp.encryptedRecoveryMasterKey),
			encryptedRecoveryMasterKeyIV: fromBase64(resp.encryptedRecoveryMasterKeyIV)
		};

		const { frontHalf, backHalf } = splitRecoveryCode(recoveryCode);
		const oldAuthHash = await hashRecoveryAuthToken(backHalf);
		const zKey = await deriveRecoveryKey(frontHalf);
		const rawM = await unwrapMasterKeyRaw(
			bundle.encryptedRecoveryMasterKey,
			bundle.encryptedRecoveryMasterKeyIV,
			zKey
		);

		const masterKeyExt = await importMasterKey(rawM, true);
		const newSalt = await generateSalt();
		const newKeys = await deriveKeys(newPassword, newSalt);
		const newWrapped = await wrapMasterKey(masterKeyExt, newKeys.encryptionKey);
		const newRecovery = await createRecoveryData(masterKeyExt);
		newKeys.encryptionKey.fill(0);

		try {
			await pb.send(`/api/recover-account/${encodeURIComponent(email)}`, {
				method: 'POST',
				body: JSON.stringify({
					authTokenHash: toBase64(oldAuthHash),
					password: toBase64(newKeys.loginKey),
					passwordConfirm: toBase64(newKeys.loginKey),
					salt: toBase64(newSalt),
					encryptedMasterKey: toBase64(newWrapped.ciphertext),
					masterKeyIv: toBase64(newWrapped.iv),
					encryptedRecoveryMasterKey: toBase64(newRecovery.encryptedRecoveryMasterKey),
					recoveryMasterKeyIv: toBase64(newRecovery.encryptedRecoveryMasterKeyIV),
					recoveryAuthTokenHash: toBase64(newRecovery.recoveryAuthTokenHash)
				})
			});
		} finally {
			rawM.fill(0);
		}

		await this.login(email, newPassword);

		return newRecovery.recoveryCode.fullCode;
	}

	/**
	 * Change password while logged in.
	 * Gets raw M from server's M(Y) using old password.
	 * Returns the new recovery code that replaces the old one.
	 */
	static async changePassword(oldPassword: string, newPassword: string): Promise<string> {
		const { userId } = getActiveSession();
		const email = pb.authStore.record?.email;
		if (!email) throw new AppError('NOT_AUTHENTICATED', 'Not logged in to PocketBase.');

		const oldSaltResp = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const oldKeys = await deriveKeys(oldPassword, fromBase64(oldSaltResp.salt));

		const record = pb.authStore.record;
		if (!record) throw new AppError('NOT_AUTHENTICATED', 'Not authenticated.');
		let rawM: Uint8Array<ArrayBuffer>;
		try {
			rawM = await unwrapMasterKeyRaw(
				fromBase64(record.encryptedMasterKey),
				fromBase64(record.masterKeyIv),
				oldKeys.encryptionKey
			);
		} catch {
			oldKeys.encryptionKey.fill(0);
			throw new AppError('INVALID_CREDENTIALS', 'Incorrect current password.');
		}

		const masterKeyExt = await importMasterKey(rawM, true);
		const newSalt = await generateSalt();
		const newKeys = await deriveKeys(newPassword, newSalt);
		const newWrapped = await wrapMasterKey(masterKeyExt, newKeys.encryptionKey);
		const newRecovery = await createRecoveryData(masterKeyExt);
		newKeys.encryptionKey.fill(0);
		rawM.fill(0);

		await pb.collection('users').update(userId, {
			oldPassword: toBase64(oldKeys.loginKey),
			password: toBase64(newKeys.loginKey),
			passwordConfirm: toBase64(newKeys.loginKey),
			salt: toBase64(newSalt),
			encryptedMasterKey: toBase64(newWrapped.ciphertext),
			masterKeyIv: toBase64(newWrapped.iv),
			encryptedRecoveryMasterKey: toBase64(newRecovery.encryptedRecoveryMasterKey),
			recoveryMasterKeyIv: toBase64(newRecovery.encryptedRecoveryMasterKeyIV),
			recoveryAuthTokenHash: toBase64(newRecovery.recoveryAuthTokenHash)
		});

		await this.login(email, newPassword);

		return newRecovery.recoveryCode.fullCode;
	}

	/**
	 * Unlink account: Revert to guest mode.
	 * Requires current password to retrieve raw M from server,
	 * then upgrades local key back to extractable: true.
	 */
	static async unlinkAccount(password: string): Promise<void> {
		const { userId } = getActiveSession();
		const email = pb.authStore.record?.email;
		if (!email) throw new AppError('NOT_AUTHENTICATED', 'Not logged in to PocketBase.');

		const saltResp = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const keys = await deriveKeys(password, fromBase64(saltResp.salt));

		const record = pb.authStore.record;
		if (!record) throw new AppError('NOT_AUTHENTICATED', 'Not authenticated.');
		let rawM: Uint8Array<ArrayBuffer>;
		try {
			rawM = await unwrapMasterKeyRaw(
				fromBase64(record.encryptedMasterKey),
				fromBase64(record.masterKeyIv),
				keys.encryptionKey
			);
		} catch {
			keys.encryptionKey.fill(0);
			throw new AppError('INVALID_CREDENTIALS', 'Incorrect password.');
		}
		keys.encryptionKey.fill(0);

		try {
			await pb.collection('users').delete(userId);

			// Upgrade local key BEFORE clearing PB auth so that when onChange fires,
			// the session already sees isGuest: true.
			const unlockedKey = await importMasterKey(rawM, true);
			await UserService.revertToGuest(userId, unlockedKey);
		} finally {
			rawM.fill(0);
		}

		pb.authStore.clear();
	}

	/**
	 * Logout: Disconnect from PocketBase cloud sync.
	 * Local session (userId + masterKey) is preserved so the user retains
	 * access to their locally-stored encrypted data.
	 */
	static async logout(): Promise<void> {
		SyncManager.stopAutoSync();
		pb.authStore.clear();
	}
}
