import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn()
}));

vi.mock('$lib/adapters/http', () => ({
    appHttp: { fetch: mocks.fetch }
}));

import { cdnFetch } from '$lib/utils/cdn';

describe('cdnFetch', () => {
    beforeEach(() => {
        mocks.fetch.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('loads from the local public path in development without persistent caching', async () => {
        const open = vi.fn();
        vi.stubGlobal('caches', { open });
        mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

        const result = await cdnFetch('/token/o200k_base/tokenizer.json');

        expect(mocks.fetch).toHaveBeenCalledWith('/token/o200k_base/tokenizer.json');
        expect(open).not.toHaveBeenCalled();
        expect([...new Uint8Array(result)]).toEqual([1, 2, 3]);
    });
});
