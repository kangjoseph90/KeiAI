import { AppError } from '$lib/types/errors';
import { isRecord } from '$lib/utils/record';
import type { RisuRegexScript } from './ccv3';
import { decodeRPack, encodeRPack } from './rpack';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const RISU_MODULE_MAGIC = 111;
const RISU_MODULE_VERSION = 0;

export interface RisuModule {
    name?: string;
    description?: string;
    id?: string;
    trigger?: unknown[];
    regex?: RisuRegexScript[];
    lorebook?: RisuInternalLorebook[];
}

export interface RisuInternalLorebook {
    key: string;
    secondkey?: string;
    insertorder?: number;
    comment?: string;
    content: string;
    mode?: string;
    alwaysActive?: boolean;
    selective?: boolean;
    useRegex?: boolean;
}

export function readRisuModule(bytes: Uint8Array): RisuModule {
    const state = { offset: 0 };
    if (readByte(bytes, state) !== RISU_MODULE_MAGIC) {
        throw new AppError('INVALID_INPUT', 'Invalid Risu module magic');
    }
    if (readByte(bytes, state) !== RISU_MODULE_VERSION) {
        throw new AppError('INVALID_INPUT', 'Unsupported Risu module version');
    }

    const mainLength = readUint32LE(bytes, state);
    const mainBytes = readBytes(bytes, state, mainLength);
    const decoded = decodeRPack(mainBytes);
    const parsed = JSON.parse(TEXT_DECODER.decode(decoded)) as unknown;
    if (!isRecord(parsed) || parsed.type !== 'risuModule' || !isRecord(parsed.module)) {
        throw new AppError('INVALID_INPUT', 'Invalid Risu module');
    }
    return parsed.module as unknown as RisuModule;
}

export function writeRisuModule(module: RisuModule): Uint8Array {
    const body = TEXT_ENCODER.encode(
        JSON.stringify(
            {
                module,
                type: 'risuModule'
            },
            null,
            2
        )
    );
    const encoded = encodeRPack(body);
    const output = new Uint8Array(1 + 1 + 4 + encoded.length + 1);
    let offset = 0;
    output[offset++] = RISU_MODULE_MAGIC;
    output[offset++] = RISU_MODULE_VERSION;
    writeUint32LE(output, offset, encoded.length);
    offset += 4;
    output.set(encoded, offset);
    output[offset + encoded.length] = 0;
    return output;
}

function readByte(bytes: Uint8Array, state: { offset: number }): number {
    return bytes[state.offset++] ?? 0;
}

function readUint32LE(bytes: Uint8Array, state: { offset: number }): number {
    const value =
        (bytes[state.offset] ?? 0) |
        ((bytes[state.offset + 1] ?? 0) << 8) |
        ((bytes[state.offset + 2] ?? 0) << 16) |
        ((bytes[state.offset + 3] ?? 0) << 24);
    state.offset += 4;
    return value >>> 0;
}

function readBytes(bytes: Uint8Array, state: { offset: number }, length: number): Uint8Array {
    const data = bytes.slice(state.offset, state.offset + length);
    state.offset += length;
    return data;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
}
