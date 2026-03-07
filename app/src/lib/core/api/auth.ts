/**
 * Auth API — All account flows in single-call functions.
 * Uses pure crypto utilities + session manager. No multi-step dance.
 *
 * Master key extractability lifecycle:
 *   Guest  (extractable: true)  → register() → Registered (extractable: false)
 *   Registered (extractable: false) → unlinkAccount() → Guest (extractable: true)
 */

import { pb } from './pb.js';
import {
	generateSalt,
	deriveKeys,
	wrapMasterKey,
	unwrapMasterKeyRaw,
	createRecoveryData,
	deriveRecoveryKey,
	hashRecoveryAuthToken,
	splitRecoveryCode,
	toBase64,
	fromBase64,
	type RecoveryBundle
} from '../crypto/index.js';
import {
	getActiveSession,
	setSession,
	clearSession,
	importMasterKey,
	unlockMasterKey
} from '../../session.js';
import { appUser, type UserRecord } from '../../adapters/user/index.js';
import { refreshAuthState } from '../../stores/auth.js';
import { clearActiveCharacter, loadGlobalState } from '../../stores/index.js';
import { SyncService } from './sync.js';

export class AuthService {
	/**
	 * Register: Link current guest account to a new server account.
	 * Returns the 16-char recovery code that UI must force user to save.
	 * After successful registration, the local master key is downgraded to extractable: false.
	 */
	static async register(email: string, password: string): Promise<string> {
		const { userId, masterKey, isGuest } = getActiveSession();
		if (!isGuest) {
			throw new Error('Already registered. Unlink your account to revert to guest mode.');
		}

		// Derive keys
		const salt = await generateSalt();
		const { loginKey, encryptionKey } = await deriveKeys(password, salt);

		// Wrap M with Y — works because guest key is extractable: true
		const wrapped = await wrapMasterKey(masterKey, encryptionKey);

		// Recovery data
		const recovery = await createRecoveryData(masterKey);
		encryptionKey.fill(0);
		loginKey.fill(0);

		const existing = await appUser.getUser(userId);

		const createData: Record<string, any> = {
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

		// If the user set a custom avatar while offline (saved as Base64 Data URI),
		// convert it to a Blob so the PocketBase SDK uploads it as a file.
		if (existing?.avatar?.startsWith('data:image')) {
			try {
				const fetchResponse = await fetch(existing.avatar);
				createData.avatar = await fetchResponse.blob();
			} catch (e) {
				console.warn('Failed to parse local avatar for PB upload', e);
			}
		}

		// Send to PocketBase — force the local guest UUID as the server record id.
		// This ensures local DB records (userId FK) always stay in sync with the
		// PocketBase record id without any data migration.
		await pb.collection('users').create(createData);

		// Login to initialize the registered session (lock master key etc.)
		await this.login(email, password);

		return recovery.recoveryCode.fullCode;
	}

	/**
	 * Login: Single-call E2EE login.
	 * Fetches salt → derives X,Y → auths with X → unwraps M(Y) → sets session.
	 * Stores the master key as extractable: false (registered user).
	 */
	static async login(email: string, password: string): Promise<void> {
		// 1. Fetch salt
		const { salt } = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const saltBytes = fromBase64(salt);

		// 2. Derive X, Y
		const { loginKey, encryptionKey } = await deriveKeys(password, saltBytes);

		// 3. Auth with X
		const authData = await pb.collection('users').authWithPassword(email, toBase64(loginKey));

		// 4. Unwrap M(Y) with Y → get raw bytes
		const rawM = await unwrapMasterKeyRaw(
			fromBase64(authData.record.encryptedMasterKey),
			fromBase64(authData.record.masterKeyIv),
			encryptionKey
		);

		let lockedKey: CryptoKey;
		try {
			// 5. Import as non-extractable CryptoKey.
			//    We use the PocketBase record's id (= the guest UUID we sent at register time)
			//    as the local userId, so no data migration is ever needed.
			lockedKey = await importMasterKey(rawM, false);

			await appUser.backupGuestKey(authData.record.id, rawM); // no-op on web
		} finally {
			rawM.fill(0);
		}

		const serverUserId = authData.record.id;

		// Update the existing UserRecord in-place (may already exist as a guest record
		// with this same id, or be a fresh login on a new device).
		const existing = await appUser.getUser(serverUserId);

		// If there is no existing local record (IndexedDB wiped, first install on this
		// device, or first login ever), the sync cursors in localStorage either don't
		// exist or are stale from a previous install. Reset them so the first
		// syncAll() below performs a full pull and restores all remote data.
		if (!existing) {
			await SyncService.resetCursors(serverUserId);
		}

		let pbAvatarUrl = undefined;
		if (authData.record?.avatar) {
			pbAvatarUrl = pb.files.getURL(authData.record, authData.record.avatar);
		}

		await appUser.saveUser({
			id: serverUserId,
			name: existing?.name ?? authData.record?.name ?? 'Synced Profile',
			email: email,
			avatar: existing?.avatar ?? pbAvatarUrl ?? `https://api.dicebear.com/7.x/identicon/svg?seed=${serverUserId}`,
			createdAt: existing?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: false,
			masterKey: lockedKey
		});

		await setSession(serverUserId, lockedKey, false);
		refreshAuthState();
		await SyncService.syncAll();
		clearActiveCharacter();
		await loadGlobalState();
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
		// 1. Fetch recovery bundle M(Z)
		const resp = await pb.send(`/api/recovery-bundle/${encodeURIComponent(email)}`, {
			method: 'GET'
		});
		const bundle: RecoveryBundle = {
			encryptedRecoveryMasterKey: fromBase64(resp.encryptedRecoveryMasterKey),
			encryptedRecoveryMasterKeyIV: fromBase64(resp.encryptedRecoveryMasterKeyIV)
		};

		// 2. Decrypt M from M(Z) using front half of recovery code
		const { frontHalf, backHalf } = splitRecoveryCode(recoveryCode);
		const oldAuthHash = await hashRecoveryAuthToken(backHalf);
		const zKey = await deriveRecoveryKey(frontHalf);
		const rawM = await unwrapMasterKeyRaw(
			bundle.encryptedRecoveryMasterKey,
			bundle.encryptedRecoveryMasterKeyIV,
			zKey
		);

		// 3. Re-wrap M with new password
		const masterKeyExt = await importMasterKey(rawM, true);
		const newSalt = await generateSalt();
		const newKeys = await deriveKeys(newPassword, newSalt);
		const newWrapped = await wrapMasterKey(masterKeyExt, newKeys.encryptionKey);
		const newRecovery = await createRecoveryData(masterKeyExt);
		newKeys.encryptionKey.fill(0);

		try {
			// 4. Push new credentials to server
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
			// 5. Login with the new credentials — this creates the local user
			//    record with the correct PB server userId and sets the session.
			rawM.fill(0);
		}
		
		await this.login(email, newPassword);

		return newRecovery.recoveryCode.fullCode;
	}

	/**
	 * Update Profile: name and avatar.
	 * Updates local database and pushes to PocketBase if successfully logged in.
	 * If avatar is a Base64 data URI, it will be uploaded as a Blob.
	 */
	static async updateProfile(name: string, avatarDataUri?: string): Promise<void> {
		const session = getActiveSession();
		const user = await appUser.getUser(session.userId);
		if (!user) throw new Error('User not found.');

		user.name = name;
		if (avatarDataUri) {
			user.avatar = avatarDataUri;
		}
		user.updatedAt = Date.now();
        
		await appUser.saveUser(user);

		// Synchronize with server if registered and currently online
		if (!session.isGuest && pb.authStore.isValid && pb.authStore.record) {
			const updateData: Record<string, any> = { name };
			
			if (avatarDataUri && avatarDataUri.startsWith('data:image')) {
				try {
					const fetchResponse = await fetch(avatarDataUri);
					updateData.avatar = await fetchResponse.blob();
				} catch (e) {
					console.warn('Failed to parse local avatar for PB upload', e);
				}
			}
			
			const record = await pb.collection('users').update(session.userId, updateData);
			
			// If PocketBase successfully assigned an avatar file, fetch its URL so we can
			// immediately replace the Base64 in our local DB with a lighter URL string.
			if (record?.avatar) {
				user.avatar = pb.files.getURL(record, record.avatar);
				await appUser.saveUser(user);
			}
		}
        
		refreshAuthState();
	}

	/**
	 * Change password while logged in.
	 * Gets raw M from server's M(Y) using old password.
	 * Returns the new recovery code that replaces the old one.
	 */
	static async changePassword(oldPassword: string, newPassword: string): Promise<string> {
		const { userId } = getActiveSession();
		const email = pb.authStore.record?.email;
		if (!email) throw new Error('Not logged in to PocketBase.');

		// 1. Fetch salt and derive old keys
		const oldSaltResp = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const oldKeys = await deriveKeys(oldPassword, fromBase64(oldSaltResp.salt));

		// 2. Fetch encrypted M from server and unwrap with old Y
		const record = pb.authStore.record;
		if (!record) throw new Error('Not authenticated.');
		let rawM: Uint8Array<ArrayBuffer>;
		try {
			rawM = await unwrapMasterKeyRaw(
				fromBase64(record.encryptedMasterKey),
				fromBase64(record.masterKeyIv),
				oldKeys.encryptionKey
			);
		} catch {
			oldKeys.encryptionKey.fill(0);
			throw new Error('Incorrect current password.');
		}

		// 3. Re-wrap M with new password and create fresh recovery data
		const masterKeyExt = await importMasterKey(rawM, true);
		const newSalt = await generateSalt();
		const newKeys = await deriveKeys(newPassword, newSalt);
		const newWrapped = await wrapMasterKey(masterKeyExt, newKeys.encryptionKey);
		const newRecovery = await createRecoveryData(masterKeyExt);
		newKeys.encryptionKey.fill(0);
		newKeys.loginKey.fill(0);
		rawM.fill(0);

		// 4. Update server — include refreshed recovery bundle so old code is invalidated
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

		// Re-login with the new credentials to refresh the auth token
		// and ensure authStore.record has the latest encrypted fields.
		await this.login(email, newPassword);

		return newRecovery.recoveryCode.fullCode;
	}

	/**
	 * Unlink account: Revert to guest mode.
	 * Requires current password to retrieve raw M from server, then upgrades local key back to extractable: true.
	 */
	static async unlinkAccount(password: string): Promise<void> {
		const { userId } = getActiveSession();
		const email = pb.authStore.record?.email;
		if (!email) throw new Error('Not logged in to PocketBase.');

		// 1. Get raw M from server M(Y)
		const saltResp = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const keys = await deriveKeys(password, fromBase64(saltResp.salt));

		const record = pb.authStore.record;
		if (!record) throw new Error('Not authenticated.');
		let rawM: Uint8Array<ArrayBuffer>;
		try {
			rawM = await unwrapMasterKeyRaw(
				fromBase64(record.encryptedMasterKey),
				fromBase64(record.masterKeyIv),
				keys.encryptionKey
			);
		} catch {
			keys.encryptionKey.fill(0);
			throw new Error('Incorrect password.');
		}
		keys.encryptionKey.fill(0);

		try {
			// 2. Delete server account
			await pb.collection('users').delete(userId);

			// 3. Upgrade local key BEFORE clearing PB auth so that when onChange fires,
			//    refreshAuthState() already sees isGuest: true in the session.
			await unlockMasterKey(userId, rawM);
		} finally {
			rawM.fill(0);
		}

		pb.authStore.clear();
	}

	/**
	 * Logout: Disconnect from PocketBase cloud sync.
	 * Local session (userId + masterKey) is preserved so the user retains
	 * access to their locally-stored encrypted data. On next boot, the same
	 * user is restored from KV/IndexedDB and presented with the login screen.
	 */
	static async logout(): Promise<void> {
		SyncService.stopAutoSync();
		pb.authStore.clear();
		// onChange fires → refreshAuthState() → isGuest: true (not connected to PB)
		// Local session remains intact; no data loss.
	}
}
