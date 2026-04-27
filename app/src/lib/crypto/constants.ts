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
export const RECOVERY_CODE_LENGTH = 24;

/** Recovery code front half length (encryption portion Z) */
export const RECOVERY_FRONT_LENGTH = 12;

/** Recovery code back half length (auth token portion) */
export const RECOVERY_BACK_LENGTH = 12;

/** ECDH named curve for identity key pairs */
export const ECDH_CURVE = 'P-256';
