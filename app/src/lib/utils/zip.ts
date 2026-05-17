import { unzipSync, zipSync } from 'fflate';

export type ZipInput = File | Uint8Array;

export async function unzip(input: ZipInput): Promise<Record<string, Uint8Array>> {
    const bytes = input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input;
    return unzipSync(bytes);
}

export function zip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync(entries);
}
