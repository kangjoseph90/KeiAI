import { unzipSync, zipSync } from 'fflate';

export type ZipInput = File | Uint8Array;

export async function unzip(input: ZipInput): Promise<Record<string, Uint8Array>> {
    const bytes = input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input;
    try {
        return unzipSync(bytes);
    } catch (originalError) {
        for (let offset = findNextLocalHeader(bytes, 1); offset !== -1; ) {
            try {
                return unzipSync(bytes.subarray(offset));
            } catch {
                offset = findNextLocalHeader(bytes, offset + 1);
            }
        }
        throw originalError;
    }
}

export function zip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync(entries);
}

function findNextLocalHeader(bytes: Uint8Array, start: number): number {
    for (let index = start; index <= bytes.length - 4; index++) {
        if (
            bytes[index] === 0x50 &&
            bytes[index + 1] === 0x4b &&
            bytes[index + 2] === 0x03 &&
            bytes[index + 3] === 0x04
        ) {
            return index;
        }
    }
    return -1;
}
