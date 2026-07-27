/**
 * Mock TTS Stream Handler — Development / Testing
 */

import { float32ToWav } from '$lib/utils/audio';
import type { TTSStreamChunk, TTSStreamHandler } from '../types';

const SAMPLE_RATE = 16_000;
const MORSE_UNIT_SECONDS = 0.06;

const MORSE: Record<string, string> = {
    A: '.-',
    B: '-...',
    C: '-.-.',
    D: '-..',
    E: '.',
    F: '..-.',
    G: '--.',
    H: '....',
    I: '..',
    J: '.---',
    K: '-.-',
    L: '.-..',
    M: '--',
    N: '-.',
    O: '---',
    P: '.--.',
    Q: '--.-',
    R: '.-.',
    S: '...',
    T: '-',
    U: '..-',
    V: '...-',
    W: '.--',
    X: '-..-',
    Y: '-.--',
    Z: '--..',
    '0': '-----',
    '1': '.----',
    '2': '..---',
    '3': '...--',
    '4': '....-',
    '5': '.....',
    '6': '-....',
    '7': '--...',
    '8': '---..',
    '9': '----.',
    '?': '..--..'
};

export type MockTTSBehavior = 'sample' | 'morse';

export interface MockTTSConfig {
    behavior?: MockTTSBehavior;
}

export class MockTTSStreamHandler implements TTSStreamHandler {
    private readonly behavior: MockTTSBehavior;

    constructor(config: MockTTSConfig = {}) {
        this.behavior = config.behavior ?? 'sample';
    }

    async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TTSStreamChunk> {
        if (!text.trim()) return;
        signal.throwIfAborted();

        const samples = this.behavior === 'sample' ? createSampleAudio() : createMorseAudio(text);
        signal.throwIfAborted();
        yield {
            data: float32ToWav(samples, SAMPLE_RATE),
            mimeType: 'audio/wav'
        };
    }
}

function createSampleAudio(): Float32Array {
    const duration = 1.4;
    const samples = new Float32Array(Math.ceil(SAMPLE_RATE * duration));
    const notes = [
        { start: 0.05, end: 0.45, frequency: 523.25 },
        { start: 0.45, end: 0.85, frequency: 659.25 },
        { start: 0.85, end: 1.35, frequency: 783.99 }
    ];
    for (const note of notes) {
        const start = Math.floor(note.start * SAMPLE_RATE);
        const end = Math.floor(note.end * SAMPLE_RATE);
        for (let index = start; index < end; index += 1) {
            const elapsed = (index - start) / SAMPLE_RATE;
            const remaining = (end - index) / SAMPLE_RATE;
            const envelope = Math.min(1, elapsed / 0.02, remaining / 0.06);
            samples[index] += Math.sin(2 * Math.PI * note.frequency * elapsed) * envelope * 0.25;
        }
    }
    return samples;
}

function createMorseAudio(text: string): Float32Array {
    const events: Array<{ tone: boolean; units: number }> = [];
    const characters = [...text.toUpperCase().slice(0, 200)];
    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (/\s/u.test(character)) {
            appendSilence(events, 7);
            continue;
        }

        const code = MORSE[character] ?? MORSE['?'];
        for (let symbolIndex = 0; symbolIndex < code.length; symbolIndex += 1) {
            events.push({ tone: true, units: code[symbolIndex] === '-' ? 3 : 1 });
            if (symbolIndex < code.length - 1) appendSilence(events, 1);
        }
        if (index < characters.length - 1 && !/\s/u.test(characters[index + 1])) {
            appendSilence(events, 3);
        }
    }

    const unitSamples = Math.round(SAMPLE_RATE * MORSE_UNIT_SECONDS);
    const sampleCount = events.reduce((total, event) => total + event.units * unitSamples, 0);
    const samples = new Float32Array(sampleCount);
    let offset = 0;
    for (const event of events) {
        const length = event.units * unitSamples;
        if (event.tone) {
            for (let index = 0; index < length; index += 1) {
                const envelope = Math.min(1, index / 80, (length - index) / 80);
                samples[offset + index] =
                    Math.sin((2 * Math.PI * 700 * index) / SAMPLE_RATE) * envelope * 0.3;
            }
        }
        offset += length;
    }
    return samples;
}

function appendSilence(events: Array<{ tone: boolean; units: number }>, units: number): void {
    const previous = events.at(-1);
    if (previous && !previous.tone) {
        previous.units = Math.max(previous.units, units);
    } else {
        events.push({ tone: false, units });
    }
}
