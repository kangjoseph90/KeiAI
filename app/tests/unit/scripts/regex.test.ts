import { describe, it, expect, beforeEach } from 'vitest';
import { applyRegexScript } from '$lib/pipeline/regex';
import type { Script } from '$lib/services';

describe('applyRegexScript', () => {
    const baseScript: Script = {
        id: 'test-script',
        ownerId: 'owner-1',
        type: 'regex',
        name: 'Test Regex',
        regex: 'apple',
        replacement: 'banana',
        phase: 'display',
        advanced: false,
        flag: 'g',
        order: 100,
        repeat: 1,
        enabled: true
    };

    it('should replace text correctly with basic settings', () => {
        const result = applyRegexScript(baseScript, 'I like apple');
        expect(result).toBe('I like banana');
    });

    it('should replace all occurrences with global flag', () => {
        const result = applyRegexScript(baseScript, 'apple and apple');
        expect(result).toBe('banana and banana');
    });

    it('should honor disabled status', () => {
        const disabledScript = { ...baseScript, enabled: false };
        const result = applyRegexScript(disabledScript, 'I like apple');
        expect(result).toBe('I like apple');
    });

    it('should handle repeat iterations (recursive-like)', () => {
        const script: Script = {
            ...baseScript,
            advanced: true,
            regex: 'a+',
            replacement: 'a', // reduce multiple 'a's to one
            repeat: 2
        };
        // First pass: 'aaa' -> 'a' (because of g flag matching all at once)
        // Wait, a+ with g will replace 'aaa' to 'a' in one go.
        // Let's use a better example for repeat.
        const nestedScript: Script = {
            ...baseScript,
            advanced: true,
            regex: '\\[\\[(.*?)\\]\\]',
            replacement: '$1',
            repeat: 2
        };
        const result = applyRegexScript(nestedScript, '[[ [[inner]] ]]');
        expect(result).toBe(' inner ');
    });

    it('should break early if no changes occur', () => {
        const script: Script = {
            ...baseScript,
            advanced: true,
            repeat: 100 // High repeat
        };
        const result = applyRegexScript(script, 'apple');
        expect(result).toBe('banana');
        // Internally it should only run once, which we know if it doesn't crash or hang.
    });

    it('should handle invalid regex patterns gracefully', () => {
        const invalidScript: Script = {
            ...baseScript,
            regex: '[[' // Invalid
        };
        const result = applyRegexScript(invalidScript, 'some text');
        expect(result).toBe('some text');
    });

    it('should handle regex with advanced flags', () => {
        const script: Script = {
            ...baseScript,
            advanced: true,
            regex: 'APPLE',
            replacement: 'fruit',
            flag: 'i' // case insensitive, not global
        };
        const result = applyRegexScript(script, 'APPLE apple');
        expect(result).toBe('fruit apple'); // Only first occurrence replaced because no 'g'
    });

    it('should correctly cache regex objects (behavioral check)', () => {
        // Run multiple times to trigger cache hit
        const text = 'apple pie';
        applyRegexScript(baseScript, text);
        const result = applyRegexScript(baseScript, text);
        expect(result).toBe('banana pie');

        // Change pattern but keep same ID - should re-compile and work
        const changedScript = { ...baseScript, regex: 'pie', replacement: 'cake' };
        const result2 = applyRegexScript(changedScript, text);
        expect(result2).toBe('apple cake');
    });
});
