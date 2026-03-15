/**
 * Script Executor — KeiAI
 *
 * Simple regex-based text transformation.
 */

import type { Script } from '$lib/services/content/script';

/**
 * Apply scripts to text based on placement.
 * Returns the transformed text.
 */
export async function applyScripts(
	text: string,
	scripts: Script[],
	placement: 'input' | 'request' | 'output' | 'display'
): Promise<string> {
	// Filter scripts for this placement
	const filteredScripts = scripts.filter((s) => s.enabled && s.placement === placement);

	if (filteredScripts.length === 0) {
		return text;
	}

	let result = text;

	// Apply scripts in order
	for (const script of filteredScripts) {
		try {
			const regex = new RegExp(script.regex, 'gi');
			result = result.replace(regex, script.replacement);
		} catch (error) {
			// Continue with other scripts even if one fails
		}
	}

	return result;
}
