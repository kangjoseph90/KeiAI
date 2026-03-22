/**
 * Inference Adapter — KeiAI
 *
 * Dispatches to the appropriate inference implementation based on platform.
 * Web: @huggingface/transformers (ONNX WASM / WebGPU)
 * Tauri: native ONNX Runtime / candle (stub — future milestone)
 */

export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { webInference } from './web';
import { tauriInference } from './tauri';

/**
 * The inference adapter instance.
 * Dispatches to the appropriate implementation based on platform.
 */
export const appInference = isTauri() ? tauriInference : webInference;
