/**
 * Auth API — All account flows in single-call functions.
 * Uses pure crypto utilities + session manager. No multi-step dance.
 */

import { pb } from './pb.js';
import {
	generateSalt,
	deriveKeys,
	wrapMasterKey,
	unwrapMasterKeyRaw,
	createRecoveryData,
	splitRecoveryCode,
	hashRecoveryAuthToken,
	deriveRecoveryKey,
	toBase64,
	fromBase64,
	type RecoveryBundle
} from '../crypto/index.js';
import {
	getActiveSession,
	setSession,
	clearSession,
	importMasterKey
} from '../session.js';
import { localDB, type UserRecord } from '../db/index.js';

export class AuthService {
	/**
	 * Register: Link current guest account to a new server account.
	 * Returns the 16-char recovery code that UI must force user to save.
	 */
	static async register(email: string, password: string): Promise<string> {
		const { userId } = getActiveSession();
		const user = await localDB.getRecord<UserRecord>('users', userId);
		if (!user) throw new Error('No active user record.');

		// Derive keys
		const salt = generateSalt();
		const { loginKey, encryptionKey } = await deriveKeys(password, salt);

		// Wrap M with Y
		const masterKeyExt = await importMasterKey(user.masterKey, true);
		const wrapped = await wrapMasterKey(masterKeyExt, encryptionKey);

		// Recovery data
		const recovery = await createRecoveryData(masterKeyExt);
		encryptionKey.fill(0);

		// Send to PocketBase
		await pb.collection('users').create({
			email,
			password: toBase64(loginKey),
			passwordConfirm: toBase64(loginKey),
			salt: toBase64(salt),
			encryptedMasterKey: toBase64(wrapped.ciphertext),
			masterKeyIv: toBase64(wrapped.iv),
			encryptedRecoveryMasterKey: toBase64(recovery.encryptedRecoveryMasterKey),
			recoveryMasterKeyIv: toBase64(recovery.encryptedRecoveryMasterKeyIV),
			recoveryAuthTokenHash: toBase64(recovery.recoveryAuthTokenHash)
		});

		// Mark local user as non-guest
		user.isGuest = false;
		user.updatedAt = Date.now();
		await localDB.putRecord('users', user);

		// Login to adopt the PocketBase UUID
		await this.login(email, password);

		return recovery.recoveryCode.fullCode;
	}

	/**
	 * Login: Single-call E2EE login.
	 * Fetches salt → derives X,Y → auths with X → unwraps M(Y) → sets session.
	 */
	static async login(email: string, password: string): Promise<void> {
		// 1. Fetch salt
		const { salt } = await pb.send(`/api/salt/${encodeURIComponent(email)}`, { method: 'GET' });
		const saltBytes = fromBase64(salt);

		// 2. Derive X, Y
		const { loginKey, encryptionKey } = await deriveKeys(password, saltBytes);

		// 3. Auth with X
		const authData = await pb.collection('users').authWithPassword(email, toBase64(loginKey));

		// 4. Unwrap M(Y) with Y
		const rawM = await unwrapMasterKeyRaw(
			fromBase64(authData.record.encryptedMasterKey),
			fromBase64(authData.record.masterKeyIv),
			encryptionKey
		);

		// 5. Save to local DB and set session
		const serverUserId = authData.record.id;
		const memoryKey = await importMasterKey(rawM, false);

		await localDB.putRecord('users', {
			id: serverUserId,
			userId: serverUserId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: false,
			masterKey: new Uint8Array(rawM)
		} as UserRecord);

		setSession(serverUserId, memoryKey, false);
		rawM.fill(0);
	}

	/**
	 * Recover password using the 16-char analog recovery code.
	 * Returns the NEW recovery code that replaces the old one.
	 */
	static async recoverPassword(email: string, recoveryCode: string, newPassword: string): Promise<string> {
		// 1. Fetch recovery bundle M(Z)
		const resp = await pb.send(`/api/recovery-bundle/${encodeURIComponent(email)}`, { method: 'GET' });
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
		const newSalt = generateSalt();
		const newKeys = await deriveKeys(newPassword, newSalt);
		const newWrapped = await wrapMasterKey(masterKeyExt, newKeys.encryptionKey);
		const newRecovery = await createRecoveryData(masterKeyExt);
		newKeys.encryptionKey.fill(0);

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

		// 5. Login with the new credentials — this creates the local user
		//    record with the correct PB server userId and sets the session.
		rawM.fill(0);
		await this.login(email, newPassword);

		return newRecovery.recoveryCode.fullCode;
	}

	/**
	 * Change password while logged in.
	 */
	static async changePassword(oldPassword: string, newPassword: string): Promise<void> {
		const { userId } = getActiveSession();
		const user = await localDB.getRecord<UserRecord>('users', userId);
		if (!user) throw new Error('No active user record.');

		// Re-wrap M with new password
		const masterKeyExt = await importMasterKey(user.masterKey, true);
		const newSalt = generateSalt();
		const newKeys = await deriveKeys(newPassword, newSalt);
		const newWrapped = await wrapMasterKey(masterKeyExt, newKeys.encryptionKey);
		newKeys.encryptionKey.fill(0);

		// Update server
		// NOTE: PocketBase requires oldPassword for password change via its API. 
		// We need the old X for this. Derive it.
		const oldSaltResp = await pb.send(`/api/salt/${encodeURIComponent(pb.authStore.record?.email || '')}`, { method: 'GET' });
		const oldKeys = await deriveKeys(oldPassword, fromBase64(oldSaltResp.salt));

		await pb.collection('users').update(userId, {
			oldPassword: toBase64(oldKeys.loginKey),
			password: toBase64(newKeys.loginKey),
			passwordConfirm: toBase64(newKeys.loginKey),
			salt: toBase64(newSalt),
			encryptedMasterKey: toBase64(newWrapped.ciphertext),
			masterKeyIv: toBase64(newWrapped.iv)
		});
		oldKeys.encryptionKey.fill(0);
	}

	static logout(): void {
		pb.authStore.clear();
		clearSession();
	}
}
