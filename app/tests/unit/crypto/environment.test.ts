import { describe, expect, it } from 'vitest';
import {
    getWebCryptoAvailabilityIssue,
    type WebCryptoEnvironment
} from '../../../src/lib/crypto/environment';

const subtle = {} as SubtleCrypto;
const getRandomValues: Crypto['getRandomValues'] = <T extends ArrayBufferView | null>(array: T) =>
    array;

describe('getWebCryptoAvailabilityIssue', () => {
    it('allows secure environments with Web Crypto primitives', () => {
        const environment: WebCryptoEnvironment = {
            isSecureContext: true,
            crypto: {
                subtle,
                getRandomValues
            }
        };

        expect(getWebCryptoAvailabilityIssue(environment)).toBeNull();
    });

    it('reports insecure contexts when subtle crypto is unavailable', () => {
        const environment: WebCryptoEnvironment = {
            isSecureContext: false,
            crypto: {
                getRandomValues
            }
        };

        expect(getWebCryptoAvailabilityIssue(environment)).toMatchObject({
            kind: 'insecure-context',
            title: 'KeiAI requires a secure connection'
        });
    });

    it('reports missing crypto object', () => {
        const environment: WebCryptoEnvironment = {
            isSecureContext: true
        };

        expect(getWebCryptoAvailabilityIssue(environment)).toMatchObject({
            kind: 'missing-crypto'
        });
    });

    it('reports missing secure random generation', () => {
        const environment: WebCryptoEnvironment = {
            isSecureContext: true,
            crypto: {
                subtle
            }
        };

        expect(getWebCryptoAvailabilityIssue(environment)).toMatchObject({
            kind: 'missing-random-values'
        });
    });
});
