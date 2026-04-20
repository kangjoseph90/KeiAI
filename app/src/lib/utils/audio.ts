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
