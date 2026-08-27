/**
 * Audio Utilities — KeiAI
 *
 * Decodes audio files (WebM, WAV, etc.) into Float32Array PCM samples
 * suitable for Transformers.js automatic-speech-recognition pipelines.
 *
 * Uses the Web Audio API (AudioContext.decodeAudioData) on web.
 */

export async function decodeAudio(arrayBuffer: ArrayBuffer): Promise<Float32Array> {
    const audioCtx = new AudioContext({ sampleRate: 16000 });

    try {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // Mix down to mono by averaging channels
        const channelCount = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const mono = new Float32Array(length);

        for (let ch = 0; ch < channelCount; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                mono[i] += channelData[i] / channelCount;
            }
        }

        return mono;
    } finally {
        await audioCtx.close();
    }
}

export function pcm16ToWav(
    pcm: Uint8Array<ArrayBuffer>,
    sampleRate: number,
    channels = 1
): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(44 + pcm.byteLength);
    writeWavHeader(bytes, pcm.byteLength, sampleRate, channels);
    bytes.set(pcm, 44);
    return bytes;
}

export function float32ToWav(
    samples: Float32Array,
    sampleRate: number,
    channels = 1
): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(44 + samples.length * 2);
    writeWavHeader(bytes, samples.length * 2, sampleRate, channels);
    const view = new DataView(bytes.buffer, 44);
    for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return bytes;
}

function writeWavHeader(
    bytes: Uint8Array<ArrayBuffer>,
    pcmByteLength: number,
    sampleRate: number,
    channels: number
): void {
    const view = new DataView(bytes.buffer);
    writeAscii(bytes, 0, 'RIFF');
    view.setUint32(4, 36 + pcmByteLength, true);
    writeAscii(bytes, 8, 'WAVE');
    writeAscii(bytes, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeAscii(bytes, 36, 'data');
    view.setUint32(40, pcmByteLength, true);
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index);
    }
}
