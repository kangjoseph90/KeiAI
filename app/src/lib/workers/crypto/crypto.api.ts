/**
 * Crypto Worker API — Phase 1: AES-GCM encrypt/decrypt.
 *
 * This object is exposed to the main thread via Comlink.
 * All functions are pure and stateless — the worker holds no keys or session state.
 */

import { encrypt, decrypt, encryptBytes, decryptBytes } from '../../crypto/encryption.js';
import { deriveKeys, generateSalt } from '../../crypto/kdf.js';
import { wrapMasterKey, unwrapMasterKeyRaw, unwrapMasterKey } from '../../crypto/masterKey.js';
import {
	createRecoveryData,
	deriveRecoveryKey,
	hashRecoveryAuthToken
} from '../../crypto/recovery.js';
import type { EncryptedData, DerivedKeys } from '../../crypto/types.js';

type Bytes = Uint8Array<ArrayBuffer>;

const cryptoApi = {
	encrypt(masterKey: CryptoKey, plaintext: string): Promise<EncryptedData> {
		return encrypt(masterKey, plaintext);
	},

	decrypt(masterKey: CryptoKey, data: EncryptedData): Promise<string> {
		return decrypt(masterKey, data);
	},

	encryptBytes(masterKey: CryptoKey, data: Bytes): Promise<EncryptedData> {
		return encryptBytes(masterKey, data);
	},

	decryptBytes(masterKey: CryptoKey, data: EncryptedData): Promise<Bytes> {
		return decryptBytes(masterKey, data);
	},

	// ─── Phase 2: KDF, Master Key & Recovery ──────────────────────────────

	// KDF
	generateSalt(): Bytes {
		return generateSalt();
	},
	deriveKeys(password: string, salt: Bytes): Promise<DerivedKeys> {
		return deriveKeys(password, salt);
	},

	// Master Key Wrapping
	wrapMasterKey(
		masterKey: CryptoKey,
		wrappingKeyBytes: Bytes
	): Promise<{ ciphertext: Bytes; iv: Bytes }> {
		return wrapMasterKey(masterKey, wrappingKeyBytes);
	},
	unwrapMasterKeyRaw(ciphertext: Bytes, iv: Bytes, wrappingKeyBytes: Bytes): Promise<Bytes> {
		return unwrapMasterKeyRaw(ciphertext, iv, wrappingKeyBytes);
	},
	// Note: unwrapMasterKey() is less useful here because it returns non-extractable CryptoKey
	// inside the Worker, which we can't export back! We leave that to main thread.

	// Recovery
	createRecoveryData(masterKey: CryptoKey) {
		return createRecoveryData(masterKey);
	},
	deriveRecoveryKey(frontHalf: string): Promise<Bytes> {
		return deriveRecoveryKey(frontHalf);
	},
	hashRecoveryAuthToken(backHalf: string): Promise<Bytes> {
		return hashRecoveryAuthToken(backHalf);
	}
};

export type CryptoApi = typeof cryptoApi;
export default cryptoApi;
