/**
 * Cryptographic constants for the E2EE system.
 *
 * All values are chosen for a strong security baseline while remaining
 * practical for browser environments.
 */

/** PBKDF2 iteration count — OWASP 2024 recommendation for SHA-256 */
export const KDF_ITERATIONS = 600_000;

/** KDF output length in bits (split into two 256-bit halves: X and Y) */
export const KDF_OUTPUT_BITS = 512;

/** Salt length in bytes */
export const SALT_BYTES = 16;

/** AES-GCM key length in bits */
export const AES_KEY_BITS = 256;

/** AES-GCM IV (nonce) length in bytes — NIST recommended */
export const AES_IV_BYTES = 12;

/** Recovery code total length in characters */
export const RECOVERY_CODE_LENGTH = 16;

/** Recovery code front half length (encryption portion Z) */
export const RECOVERY_FRONT_LENGTH = 8;

/** Recovery code back half length (auth token portion) */
export const RECOVERY_BACK_LENGTH = 8;

/** IndexedDB database name for key storage */
export const IDB_DB_NAME = 'kei-crypto-store';

/** IndexedDB object store name */
export const IDB_STORE_NAME = 'keys';

/** Key identifier for the master key in IndexedDB */
export const IDB_MASTER_KEY_ID = 'master-key';
