import { AppError } from '$lib/types/errors';
import { asBytes, textDecoder, textEncoder } from '$lib/crypto';

export type PngInput = File | Uint8Array;

export interface PngTextChunk {
    key: string;
    value: string;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = makeCrcTable();

export function isPng(bytes: Uint8Array): boolean {
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export async function readPng(
    input: PngInput
): Promise<{ bytes: Uint8Array; chunks: PngTextChunk[] }> {
    const bytes = input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input;
    if (!isPng(bytes)) throw new AppError('INVALID_INPUT', 'Input is not a PNG');

    const chunks: PngTextChunk[] = [];
    let offset = PNG_SIGNATURE.length;
    while (offset < bytes.length) {
        const length = readUint32(bytes, offset);
        const type = text(bytes.slice(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (type === 'tEXt') {
            const data = bytes.subarray(dataStart, dataEnd);
            const separator = data.indexOf(0);
            if (separator > 0) {
                chunks.push({
                    key: text(data.subarray(0, separator)),
                    value: text(data.subarray(separator + 1))
                });
            }
        }
        offset = dataEnd + 4;
    }
    return { bytes, chunks };
}

export function writePngTextChunks(
    png: Uint8Array,
    chunks: PngTextChunk[],
    replaceKeys: string[]
): Uint8Array {
    if (!isPng(png)) throw new AppError('INVALID_INPUT', 'Input is not a PNG');

    const parts: Uint8Array[] = [PNG_SIGNATURE];
    let offset = PNG_SIGNATURE.length;
    while (offset < png.length) {
        const length = readUint32(png, offset);
        const typeBytes = png.slice(offset + 4, offset + 8);
        const type = text(typeBytes);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const fullChunkEnd = dataEnd + 4;

        if (type === 'IEND') {
            for (const chunk of chunks) parts.push(makeTextChunk(chunk));
            parts.push(png.subarray(offset, fullChunkEnd));
            break;
        }

        if (
            type !== 'tEXt' ||
            !shouldReplaceTextChunk(png.subarray(dataStart, dataEnd), replaceKeys)
        ) {
            parts.push(png.subarray(offset, fullChunkEnd));
        }

        offset = fullChunkEnd;
    }

    return concat(parts);
}

export async function imageToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
    if (isPng(bytes)) return bytes;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

    const bitmap = await createImageBitmap(new Blob([asBytes(bytes)])).catch(() => null);
    if (!bitmap) return null;

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
}

function shouldReplaceTextChunk(data: Uint8Array, replaceKeys: string[]): boolean {
    const separator = data.indexOf(0);
    if (separator <= 0) return false;
    const key = text(data.slice(0, separator));
    return replaceKeys.some((pattern) =>
        pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern
    );
}

function makeTextChunk(chunk: PngTextChunk): Uint8Array {
    const key = textEncoder.encode(chunk.key);
    const value = textEncoder.encode(chunk.value);
    const dataLength = key.length + 1 + value.length;
    const chunkBytes = new Uint8Array(12 + dataLength);

    writeUint32(chunkBytes, 0, dataLength);
    chunkBytes.set(bytes('tEXt'), 4);
    chunkBytes.set(key, 8);
    chunkBytes[8 + key.length] = 0;
    chunkBytes.set(value, 9 + key.length);
    writeUint32(chunkBytes, 12 + dataLength, crc32(chunkBytes.subarray(4, 12 + dataLength)));
    return chunkBytes;
}

function readUint32(bytesValue: Uint8Array, offset: number): number {
    return (
        (((bytesValue[offset] ?? 0) << 24) |
            ((bytesValue[offset + 1] ?? 0) << 16) |
            ((bytesValue[offset + 2] ?? 0) << 8) |
            (bytesValue[offset + 3] ?? 0)) >>>
        0
    );
}

function writeUint32(bytesValue: Uint8Array, offset: number, value: number): void {
    bytesValue[offset] = (value >>> 24) & 0xff;
    bytesValue[offset + 1] = (value >>> 16) & 0xff;
    bytesValue[offset + 2] = (value >>> 8) & 0xff;
    bytesValue[offset + 3] = value & 0xff;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
}

function text(bytesValue: Uint8Array): string {
    return textDecoder.decode(bytesValue);
}

function bytes(value: string): Uint8Array {
    return textEncoder.encode(value);
}

function concat(parts: Uint8Array[]): Uint8Array {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}
