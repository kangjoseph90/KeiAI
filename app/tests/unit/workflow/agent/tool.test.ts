import { describe, expect, it } from 'vitest';
import {
    FILE_READ_TOOL,
    FILE_WRITE_TOOL,
    requireAgentTool,
    resolveAgentTools,
    validateToolArguments
} from '$lib/workflow/agent/tool';

describe('agent tool registry', () => {
    it('resolves enabled tools in node order', () => {
        expect(resolveAgentTools(['file_write', 'file_read'])).toEqual([
            FILE_WRITE_TOOL,
            FILE_READ_TOOL
        ]);
    });

    it('provides user-facing labels independently from tool ids', () => {
        expect(FILE_READ_TOOL).toMatchObject({ id: 'file_read', label: 'File Read' });
        expect(FILE_WRITE_TOOL).toMatchObject({ id: 'file_write', label: 'File Write' });
    });

    it('rejects an unknown tool', () => {
        expect(() => requireAgentTool('missing')).toThrow('Unknown agent tool');
    });

    it('validates required fields, types, enums, and additional properties', () => {
        expect(() =>
            validateToolArguments(FILE_READ_TOOL, { namespace: 'chat', path: 'notes.txt' })
        ).not.toThrow();
        expect(() => validateToolArguments(FILE_READ_TOOL, { namespace: 'chat' })).toThrow(
            'Missing argument'
        );
        expect(() =>
            validateToolArguments(FILE_READ_TOOL, { namespace: 'device', path: 'notes.txt' })
        ).toThrow('Invalid file_read argument value');
        expect(() =>
            validateToolArguments(FILE_READ_TOOL, {
                namespace: 'chat',
                path: 'notes.txt',
                extra: true
            })
        ).toThrow('Unknown argument');
    });
});
