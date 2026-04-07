/**
 * Test Utilities — KeiAI
 *
 * Helpers for constructing valid test fixtures without requiring
 * full AppSettings objects in every test.
 */

import { defaultSettings } from '$lib/services/content/settings';
import type { AppSettings } from '$lib/services';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';

/**
 * Build a complete AppSettings object by merging overrides onto defaultSettings.
 * Use this in tests wherever you'd otherwise write `{} as AppSettings` or
 * call `appSettings.set({ theme: 'dark' })` directly (which fails the full type check).
 *
 * @example
 *   appSettings.set(makeSettings({ theme: 'dark', moduleRefs: [] }));
 */
export function makeSettings(overrides: DeepPartial<AppSettings> = {}): AppSettings {
	return deepMerge(defaultSettings as AppSettings, overrides as unknown as Record<string, unknown>);
}
