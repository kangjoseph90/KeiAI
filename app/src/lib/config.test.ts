import { describe, expect, it } from 'vitest';
import { getEnvironmentConfigIssue } from './config';

describe('getEnvironmentConfigIssue', () => {
    it('accepts a complete frontend environment', () => {
        expect(
            getEnvironmentConfigIssue({
                pbUrl: 'http://127.0.0.1:8090',
                proxyUrl: 'http://127.0.0.1:8787'
            })
        ).toBeNull();
    });

    it('reports every missing frontend variable', () => {
        expect(getEnvironmentConfigIssue({ pbUrl: '', proxyUrl: '  ' })).toEqual({
            title: 'Environment configuration required',
            message: 'Set VITE_PB_URL and VITE_PROXY_URL before starting KeiAI.',
            missingVariables: ['VITE_PB_URL', 'VITE_PROXY_URL']
        });
    });
});
