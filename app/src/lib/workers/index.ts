/**
 * Worker Façade — Single entry point for all Web Workers.
 *
 * Lazy-initializes workers on first use. Main thread code imports
 * typed proxies from here instead of touching Worker internals directly.
 *
 * Usage:
 *   import { cryptoWorker } from '$lib/workers/index.js';
 *   const encrypted = await cryptoWorker.encrypt(masterKey, plaintext);
 */

import * as Comlink from 'comlink';
import type { CryptoApi } from './crypto/crypto.api.js';

// ─── Lazy Singleton ─────────────────────────────────────────────────

let _cryptoWorker: Comlink.Remote<CryptoApi> | null = null;

function getCryptoWorker(): Comlink.Remote<CryptoApi> {
	if (!_cryptoWorker) {
		const worker = new Worker(new URL('./crypto/crypto.worker.ts', import.meta.url), {
			type: 'module'
		});
		_cryptoWorker = Comlink.wrap<CryptoApi>(worker);
	}
	return _cryptoWorker;
}

// ─── Public Proxy ───────────────────────────────────────────────────

/**
 * Crypto Worker proxy (KDF, AES-GCM encrypt/decrypt).
 *
 * Lazily spawns the worker on first property access.
 * CryptoKey arguments are transferred via Structured Clone (browser-native).
 */
export const cryptoWorker: Comlink.Remote<CryptoApi> = new Proxy({} as Comlink.Remote<CryptoApi>, {
	get(_, prop) {
		return Reflect.get(getCryptoWorker(), prop);
	}
});
