import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordScopeService } from '$lib/services/content/scope';
import { buffer } from '$lib/services/content/record_buffer';

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: { get: vi.fn() }
}));

describe('RecordScopeService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns only scope metadata for an active record', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'char-1',
            scopeType: 'room',
            scopeId: 'room-1',
            createdAt: 1,
            updatedAt: 1,
            isDeleted: false,
            data: { secret: 'not returned' }
        });

        await expect(RecordScopeService.resolve('characters', 'char-1')).resolves.toEqual({
            scopeType: 'room',
            scopeId: 'room-1'
        });
    });

    it('ignores missing and deleted records', async () => {
        vi.mocked(buffer.get).mockResolvedValueOnce(null).mockResolvedValueOnce({
            id: 'persona-1',
            scopeType: 'user',
            scopeId: 'user-1',
            createdAt: 1,
            updatedAt: 1,
            isDeleted: true,
            data: {}
        });

        await expect(RecordScopeService.resolve('personas', 'missing')).resolves.toBeNull();
        await expect(RecordScopeService.resolve('personas', 'persona-1')).resolves.toBeNull();
    });
});
