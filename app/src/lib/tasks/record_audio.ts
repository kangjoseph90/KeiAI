import type { AudioRecording, RecordedAudio } from '$lib/adapters/recording';
import { appAudioRecorder } from '$lib/adapters/recording';
import { createLogger } from '$lib/adapters/logger';
import {
    addChatDraftInlay,
    createChatInlay,
    deleteChatInlay,
    getChat,
    getChatDraft,
    loadChatDraft,
    MAX_CHAT_DRAFT_INLAYS,
    setChatDraftInlayIds
} from '$lib/stores';
import {
    clearRecordAudioTask,
    createRecordAudioTask,
    getRecordAudioTask,
    notifyRecordAudioTaskComplete,
    notifyRecordAudioTaskError,
    setRecordAudioTaskComplete,
    setRecordAudioTaskError,
    setRecordAudioTaskLevels,
    setRecordAudioTaskSaving
} from '$lib/stores/tasks/record_audio';
import { hasActiveRecording } from '$lib/stores/state';
import { AUDIO_ASSET_MIME_TYPES } from '$lib/types/asset';
import { AppError, getErrorMessage } from '$lib/types/errors';
import { createTimestampedFileName } from '$lib/utils/file';
import { generateId } from '$lib/utils/id';
import { get } from 'svelte/store';

const MAX_RECORDING_MS = 10 * 60 * 1000;
const MAX_LEVELS = 200;
const LEVEL_INTERVAL_MS = 50;
const logger = createLogger('task:record-audio');

interface RecordAudioSession {
    id: string;
    controller: AbortController;
    requestFinish: () => void;
}

const sessions = new Map<string, RecordAudioSession>();

export async function runRecordAudio(chatId: string): Promise<void> {
    assertCanStartRecording(chatId);

    const [chat, draft] = await Promise.all([getChat(chatId), loadChatDraft(chatId)]);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    if (draft.inlayIds.length >= MAX_CHAT_DRAFT_INLAYS) {
        throw new AppError('INVALID_INPUT', 'The chat draft already has the maximum attachments');
    }
    assertCanStartRecording(chatId);

    const id = generateId();
    const controller = new AbortController();
    let finishRecording!: () => void;
    const finishRequested = new Promise<void>((resolve) => {
        finishRecording = resolve;
    });
    const session: RecordAudioSession = {
        id,
        controller,
        requestFinish: finishRecording
    };
    let recording: AudioRecording | null = null;
    let createdInlayId: string | null = null;
    let lastLevelAt = 0;
    let maxDurationTimer: ReturnType<typeof setTimeout> | undefined;

    sessions.set(chatId, session);
    createRecordAudioTask(chatId, id, {
        roomId: chat.roomId,
        chatId,
        chatTitle: chat.title,
        title: 'Record audio'
    });

    try {
        recording = await appAudioRecorder.start({
            signal: controller.signal,
            onLevel: (level) => {
                const now = Date.now();
                if (now - lastLevelAt < LEVEL_INTERVAL_MS) return;
                lastLevelAt = now;
                const task = getRecordAudioTask(chatId);
                if (task?.id !== id || task.phase !== 'recording') return;
                setRecordAudioTaskLevels(chatId, id, [
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
        if (!setRecordAudioTaskSaving(chatId, id)) return;

        const currentDraft = await loadChatDraft(chatId);
        controller.signal.throwIfAborted();
        if (currentDraft.inlayIds.length >= MAX_CHAT_DRAFT_INLAYS) {
            throw new AppError(
                'INVALID_INPUT',
                'The chat draft already has the maximum attachments'
            );
        }

        const ref = await createChatInlay(chatId, recordedAudioFile(audio));
        createdInlayId = ref.id;
        controller.signal.throwIfAborted();
        if (!addChatDraftInlay(chatId, ref.id)) {
            throw new AppError(
                'INVALID_INPUT',
                'The chat draft already has the maximum attachments'
            );
        }
        controller.signal.throwIfAborted();

        if (setRecordAudioTaskComplete(chatId, id)) {
            createdInlayId = null;
            notifyRecordAudioTaskComplete(chatId);
        }
    } catch (error) {
        if (createdInlayId) await cleanupCreatedInlay(chatId, createdInlayId);
        if (controller.signal.aborted || isAbortError(error)) {
            clearRecordAudioTask(chatId, id);
            return;
        }

        const errorMessage = getErrorMessage(error, 'Audio recording failed');
        logger.error(`Audio recording for chat ${chatId} failed: ${errorMessage}`);
        if (setRecordAudioTaskError(chatId, id, errorMessage)) {
            notifyRecordAudioTaskError(chatId, errorMessage);
        }
    } finally {
        if (maxDurationTimer !== undefined) clearTimeout(maxDurationTimer);
        recording?.cancel();
        if (sessions.get(chatId)?.id === id) sessions.delete(chatId);
    }
}

export function finishRecordAudio(chatId: string): void {
    const task = getRecordAudioTask(chatId);
    const session = sessions.get(chatId);
    if (task?.phase !== 'recording' || !session || session.id !== task.id) return;
    session.requestFinish();
}

export function cancelRecordAudio(chatId: string): void {
    const task = getRecordAudioTask(chatId);
    const session = sessions.get(chatId);
    if (!task || !session || session.id !== task.id) return;
    session.controller.abort();
}

export function dismissRecordAudio(chatId: string): void {
    const task = getRecordAudioTask(chatId);
    if (!task || task.status === 'generating') return;
    clearRecordAudioTask(chatId, task.id);
}

function assertCanStartRecording(chatId: string): void {
    if (getRecordAudioTask(chatId)?.status === 'generating') {
        throw new AppError('INVALID_INPUT', `Audio recording is already active: ${chatId}`);
    }
    if (get(hasActiveRecording)) {
        throw new AppError('INVALID_INPUT', 'Another recording is already active');
    }
}

function recordedAudioFile(audio: RecordedAudio): File {
    const mimeType = audio.mimeType.trim().toLowerCase().split(';', 1)[0];
    if (!(AUDIO_ASSET_MIME_TYPES as readonly string[]).includes(mimeType)) {
        throw new AppError('ASSET_ERROR', `Unsupported recorded audio format: ${mimeType}`);
    }
    return new File(
        [audio.data],
        createTimestampedFileName('Recording', audioExtension(mimeType)),
        { type: mimeType }
    );
}

function audioExtension(mimeType: string): string {
    switch (mimeType) {
        case 'audio/mpeg':
            return 'mp3';
        case 'audio/wav':
        case 'audio/x-wav':
            return 'wav';
        case 'audio/ogg':
            return 'ogg';
        case 'audio/mp4':
            return 'm4a';
        case 'audio/webm':
            return 'webm';
        default:
            return 'audio';
    }
}

async function cleanupCreatedInlay(chatId: string, inlayId: string): Promise<void> {
    const draft = getChatDraft(chatId);
    if (draft.inlayIds.includes(inlayId)) {
        setChatDraftInlayIds(
            chatId,
            draft.inlayIds.filter((id) => id !== inlayId)
        );
    }
    await deleteChatInlay(chatId, inlayId).catch((error) =>
        logger.warn(`Failed to clean up audio inlay ${inlayId}:`, error)
    );
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
