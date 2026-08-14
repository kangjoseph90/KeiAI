import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { clearSystemLogs, MAX_SYSTEM_LOGS, systemLogs } from '$lib/stores';
import { createLogger } from '$lib/adapters/logger';

describe('System Logs Store', () => {
    beforeEach(() => {
        clearSystemLogs();
    });

    it('collects logs into systemLogs store via createLogger', () => {
        const logger = createLogger('store:test');
        logger.info('test message 1');
        logger.warn('test message 2');

        const logs = get(systemLogs);
        expect(logs.length).toBeGreaterThanOrEqual(2);

        const lastTwo = logs.slice(-2);
        expect(lastTwo[0]).toMatchObject({
            level: 'INFO',
            namespace: 'store:test',
            message: 'test message 1'
        });
        expect(lastTwo[1]).toMatchObject({
            level: 'WARN',
            namespace: 'store:test',
            message: 'test message 2'
        });
    });

    it('clears logs when clearSystemLogs is called', () => {
        const logger = createLogger('store:test');
        logger.error('err');
        expect(get(systemLogs).length).toBeGreaterThan(0);

        clearSystemLogs();
        expect(get(systemLogs)).toEqual([]);
    });

    it('caps entries at MAX_SYSTEM_LOGS FIFO', () => {
        const logger = createLogger('store:cap');
        for (let i = 0; i < MAX_SYSTEM_LOGS + 10; i++) {
            logger.info(`msg ${i}`);
        }

        const logs = get(systemLogs);
        expect(logs.length).toBe(MAX_SYSTEM_LOGS);
        expect(logs[logs.length - 1].message).toBe(`msg ${MAX_SYSTEM_LOGS + 9}`);
    });
});
