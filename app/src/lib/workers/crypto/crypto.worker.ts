/**
 * Crypto Web Worker entry point.
 *
 * This file runs inside a dedicated Worker thread.
 * It exposes the crypto API object to the main thread via Comlink.
 */

import * as Comlink from 'comlink';
import cryptoApi from './crypto.api.js';

Comlink.expose(cryptoApi);
