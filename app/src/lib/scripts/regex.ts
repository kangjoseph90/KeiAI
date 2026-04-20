import type { Script } from '$lib/services';
import { LRUCache } from '$lib/utils/cache';
import { createLogger } from '$lib/adapters/logger';

const regexCache = new LRUCache<string, RegExp>(200);

const logger = createLogger('script:regex');

export function applyRegexScript(script: Script, text: string) {
    // simple guard
    if (script.type !== 'regex' || !script.enabled) return text;

    const flag = script.advanced ? script.flag : 'g';
    const repeat = script.advanced ? script.repeat : 1;
    const pattern = script.regex;

    // LRU cache check - string key is safest for reference equality in Map
    const cacheKey = `${script.id}:${pattern}:${flag}`;
    let regex = regexCache.get(cacheKey);

    if (!regex) {
        try {
            regex = new RegExp(pattern, flag);
            regexCache.set(cacheKey, regex);
        } catch (e) {
            logger.error(`Invalid regex in script "${script.name}":`, e);
            return text;
        }
    }

    let prev = '';
    for (let i = 0; i < repeat; i++) {
        prev = text;
        text = text.replace(regex, script.replacement);

        // Stop if no more changes (optimization)
        if (prev === text) break;
    }

    return text;
}
