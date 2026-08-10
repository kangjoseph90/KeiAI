import type { AudioRecording } from '$lib/adapters/recording';
import { appAudioRecorder } from '$lib/adapters/recording';
import { createLogger } from '$lib/adapters/logger';
import { transcribeSpeech } from '$lib/managers/media';
import { appendChatDraftText, getChat } from '$lib/stores';
import {
    clearDictationTask,
    createDictationTask,
    getDictationTask,
    notifyDictationTaskComplete,
    notifyDictationTaskError,
    setDictationTaskComplete,
    setDictationTaskError,
    setDictationTaskLevels,
    setDictationTaskTranscribing
} from '$lib/stores/tasks/dictation';
import { hasActiveRecording } from '$lib/stores/state';
import { AppError, getErrorMessage } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { get } from 'svelte/store';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const MAX_LEVELS = 200;
const LEVEL_INTERVAL_MS = 50;
const logger = createLogger('task:dictation');

interface DictationSession {
    id: string;
    controller: AbortController;
    requestFinish: () => void;
}

const sessions = new Map<string, DictationSession>();

export async function runDictation(chatId: string): Promise<void> {
    assertCanStartDictation(chatId);
    const chat = await getChat(chatId);
    if (!chat) {
        throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    }
    assertCanStartDictation(chatId);

    const id = generateId();
    const controller = new AbortController();
    let finishRecording!: () => void;
    const finishRequested = new Promise<void>((resolve) => {
        finishRecording = resolve;
    });
    const session: DictationSession = {
        id,
        controller,
        requestFinish: finishRecording
    };
    let recording: AudioRecording | null = null;
    let lastLevelAt = 0;
    let maxDurationTimer: ReturnType<typeof setTimeout> | undefined;

    sessions.set(chatId, session);
    createDictationTask(chatId, id, {
        roomId: chat.roomId,
        chatId,
        chatTitle: chat.title,
        title: 'Dictation'
    });
    try {
        recording = await appAudioRecorder.start({
            signal: controller.signal,
            onLevel: (level) => {
                const now = Date.now();
                if (now - lastLevelAt < LEVEL_INTERVAL_MS) return;
                lastLevelAt = now;
                const task = getDictationTask(chatId);
                if (task?.id !== id || task.phase !== 'recording') return;
                setDictationTaskLevels(chatId, id, [
                    ...task.levels.slice(-(MAX_LEVELS - 1)),
                    level
                ]);
            }
        });
        maxDurationTimer = setTimeout(finishRecording, MAX_RECORDING_MS);

        await Promise.race([waitForFinish(finishRequested, controller.signal), recording.failure]);
        controller.signal.throwIfAborted();
        const audio = await recording.finish();
        controller.signal.throwIfAborted();
        if (!setDictationTaskTranscribing(chatId, id)) return;

        const result = await transcribeSpeech(audio, controller.signal);
        controller.signal.throwIfAborted();
        await appendChatDraftText(chatId, result.text);
        if (setDictationTaskComplete(chatId, id)) notifyDictationTaskComplete(chatId);
    } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
            clearDictationTask(chatId, id);
            return;
        }

        const errorMessage = getErrorMessage(error, 'Dictation failed');
        logger.error(`Dictation for chat ${chatId} failed: ${errorMessage}`);
        if (setDictationTaskError(chatId, id, errorMessage)) {
            notifyDictationTaskError(chatId, errorMessage);
        }
    } finally {
        if (maxDurationTimer !== undefined) clearTimeout(maxDurationTimer);
        recording?.cancel();
        if (sessions.get(chatId)?.id === id) sessions.delete(chatId);
    }
}

export function finishDictation(chatId: string): void {
    const task = getDictationTask(chatId);
    const session = sessions.get(chatId);
    if (task?.phase !== 'recording' || !session || session.id !== task.id) return;
    session.requestFinish();
}

export function cancelDictation(chatId: string): void {
    const task = getDictationTask(chatId);
    const session = sessions.get(chatId);
    if (!task || !session || session.id !== task.id) return;
    session.controller.abort();
}

export function dismissDictation(chatId: string): void {
    const task = getDictationTask(chatId);
    if (task?.phase !== 'error') return;
    clearDictationTask(chatId, task.id);
}

function assertCanStartDictation(chatId: string): void {
    if (getDictationTask(chatId)?.status === 'generating') {
        throw new AppError('INVALID_INPUT', `Dictation is already active: ${chatId}`);
    }
    if (get(hasActiveRecording)) {
        throw new AppError('INVALID_INPUT', 'Another recording is already active');
    }
}

function waitForFinish(finishRequested: Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const handleAbort = (): void => reject(signal.reason);
        signal.addEventListener('abort', handleAbort, { once: true });
        void finishRequested.then(() => {
            signal.removeEventListener('abort', handleAbort);
            resolve();
        });
    });
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
