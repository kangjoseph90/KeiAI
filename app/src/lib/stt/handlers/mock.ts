/**
 * Mock STT Handler — Development / Testing
 */

import { decodeAudio } from '$lib/utils/audio';
import type { STTHandler, STTResult } from '../types';

const SAMPLE_RATE = 16_000;
const SAMPLE_TRANSCRIPT = 'This is a mock transcription.';

export type MockSTTBehavior = 'sample' | 'diagnostic';

export interface MockSTTConfig {
    behavior?: MockSTTBehavior;
}

export class MockSTTHandler implements STTHandler {
    private readonly behavior: MockSTTBehavior;

    constructor(config: MockSTTConfig = {}) {
        this.behavior = config.behavior ?? 'sample';
    }

    async transcribe(audio: Blob, signal?: AbortSignal): Promise<STTResult> {
        signal?.throwIfAborted();
        if (this.behavior === 'sample') {
            return {
                text: SAMPLE_TRANSCRIPT,
                segments: [{ text: SAMPLE_TRANSCRIPT, start: 0, end: 1.5 }]
            };
        }

        const duration = await getDuration(audio);
        signal?.throwIfAborted();
        const name = typeof File !== 'undefined' && audio instanceof File ? audio.name : undefined;
        const lines = [
            '[Mock STT]',
            ...(name ? [`Name: ${name}`] : []),
            `Type: ${audio.type || '(unknown)'}`,
            `Size: ${audio.size} bytes`,
            `Duration: ${duration === undefined ? '(unavailable)' : `${duration.toFixed(2)} seconds`}`
        ];
        const text = lines.join('\n');
        return {
            text,
            ...(duration === undefined ? {} : { segments: [{ text, start: 0, end: duration }] })
        };
    }
}

async function getDuration(audio: Blob): Promise<number | undefined> {
    try {
        const samples = await decodeAudio(await audio.arrayBuffer());
        return samples.length / SAMPLE_RATE;
    } catch {
        return undefined;
    }
}
