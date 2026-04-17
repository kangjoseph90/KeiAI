import type { Script } from '$lib/services';

export function applyRegexScript(script: Script, text: string) {
	// simple guard
	if (script.type !== 'regex' || !script.enabled) return text;

	const flag = script.advanced ? script.flag : 'g';
	const repeat = script.advanced ? script.repeat : 1;

	// if repeat is set to 0, loop until converge
	if (repeat <= 0) {
		let prev = '';
		while (prev !== text) {
			prev = text;
			const regex = new RegExp(script.regex, flag);
			text = text.replace(regex, script.replacement);
		}
	} else {
		for (let i = 0; i < repeat; i++) {
			const regex = new RegExp(script.regex, flag);
			text = text.replace(regex, script.replacement);
		}
	}
	return text;
}
