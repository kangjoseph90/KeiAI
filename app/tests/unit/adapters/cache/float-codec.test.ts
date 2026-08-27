/**
 * Float32 Cache Value Codec Tests — KeiAI
 *
 * Protects the binary representation of persistent embedding vectors in
 * TEXT-backed cache storage (Tauri/SQLite):
 * - f32: prefixed values round-trip bit-for-bit through base64, including
 *   -0, subnormals, and extreme finite magnitudes.
 * - Non-typed-array values keep plain JSON encoding (backwards compatible
 *   with existing namespaces).
 * - Corrupt payloads decode to null so callers treat them as cache misses.
 */

import { describe, expect, it } from 'vitest';
import {
    decodeCacheValue,
    decodeFloat32Base64,
    encodeCacheValue,
    encodeFloat32Base64,
    float32FromLEBytes
} from '$lib/adapters/cache/float-codec';

const representativeVectors = (): Float32Array[] => [
    new Float32Array([1, 0, -0.5, 0.25]),
    new Float32Array([-0]), // negative zero must survive bit-exactly
    new Float32Array([1e-45]), // smallest positive subnormal Float32
    new Float32Array([1e-40, 3e-44]), // subnormal range magnitudes
    new Float32Array([16777216, -33554431]), // large-magnitude exact integers
    new Float32Array([1 / 3]), // repeating binary fraction
    new Float32Array(1536).map((_, index) => Math.sin(index + 1) * 100)
];

describe('encode/decodeFloat32Base64', () => {
    it('round-trips bit-for-bit', () => {
        for (const vector of representativeVectors()) {
            const decoded = decodeFloat32Base64(encodeFloat32Base64(vector));
            expect(decoded).toHaveLength(vector.length);
            for (let index = 0; index < vector.length; index += 1) {
                expect(Object.is(decoded[index], vector[index])).toBe(true);
            }
        }
    });

    it('is deterministic for identical input', () => {
        const vector = new Float32Array(768).map((_, index) => index * 0.5 - 192);
        expect(encodeFloat32Base64(vector)).toBe(encodeFloat32Base64(new Float32Array(vector)));
    });

    it('decodes little-endian bytes with an explicit big-endian-host fallback', () => {
        // Bytes of [1, -2] as little-endian Float32.
        const bytes = new Uint8Array([
            0x00,
            0x00,
            0x80,
            0x3f, // 1
            0x00,
            0x00,
            0x00,
            0xc0 // -2
        ]);
        const asLittleEndianHost = float32FromLEBytes(bytes, true);
        const asBigEndianHost = float32FromLEBytes(bytes, false);

        expect(Object.is(asLittleEndianHost[0], 1)).toBe(true);
        expect(Object.is(asLittleEndianHost[1], -2)).toBe(true);
        expect(Object.is(asBigEndianHost[0], 1)).toBe(true);
        expect(Object.is(asBigEndianHost[1], -2)).toBe(true);
    });

    it('rejects byte lengths that are not multiples of four', () => {
        expect(() => float32FromLEBytes(new Uint8Array(3), true)).toThrow();
    });
});

describe('encodeCacheValue / decodeCacheValue', () => {
    it('uses the self-describing f32 prefix for typed arrays', () => {
        expect(encodeCacheValue(new Float32Array([1.5]))).toMatch(/^f32:/);
        expect(decodeCacheValue(encodeCacheValue(new Float32Array([1.5])))).toEqual(
            new Float32Array([1.5])
        );
    });

    it('keeps plain JSON encoding for all other values', () => {
        expect(encodeCacheValue({ n: 1 })).toBe('{"n":1}');
        expect(encodeCacheValue([1, 2])).toBe('[1,2]');
        expect(encodeCacheValue('text')).toBe('"text"');
        expect(decodeCacheValue('{"n":1}')).toEqual({ n: 1 });
        expect(decodeCacheValue(null)).toBeNull();
    });

    it('maps corrupt payloads to null instead of throwing', () => {
        expect(decodeCacheValue('f32:not-base64!')).toBeNull();
        expect(decodeCacheValue('f32:QUJD')).toBeNull(); // 'ABC' → 3 bytes, not %4
        expect(decodeCacheValue('{broken json')).toBeNull();
    });

    it('keeps decoding JSON strings and maps invalid JSON to null', () => {
        expect(decodeCacheValue('"plain string"')).toBe('plain string');
        expect(decodeCacheValue('plain string')).toBeNull();
    });
});
