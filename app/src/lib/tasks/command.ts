import { createLogger } from '$lib/adapters/logger';
import { chatCommandHasOutput } from '$lib/managers/command';
import { emitEvent } from '$lib/events';
import { getChatVariablesBefore, prepareNextSwipe } from '$lib/managers';
import { runPipeline } from '$lib/pipeline';
import { PagedMessages, type Message } from '$lib/services';
import type { ChatCommand } from '$lib/types/command';
import { getAppSettings } from '$lib/stores/content/settings';
import { getChat } from '$lib/stores/content/chat';
import { getRoom } from '$lib/stores/content/room';
import {
    createMessage,
    getLastMessage,
    getMessage,
    updateMessageSwipe
} from '$lib/stores/content/message';
import { getCharacter } from '$lib/stores/content/character';
import { getPersona } from '$lib/stores/content/persona';
import { getChatTask } from '$lib/stores/tasks/chat';
import {
    clearCommandTask,
    createCommandTask,
    getCommandTask,
    notifyCommandTaskComplete,
    notifyCommandTaskError,
    setCommandTaskComplete,
    setCommandTaskError
} from '$lib/stores/tasks/command';
import { runTemplate, type Macro } from '$lib/template';
import { AppError, getErrorMessage } from '$lib/types/errors';
import type { RuntimeContext } from '$lib/types/context';
import { WorkflowRuntime } from '$lib/workflow';
import { toMessageContext } from '$lib/workflow/agent/context';
import {
    deserializeAgentParts,
    findLastTextIndex,
    getLastTextContent,
    hasVisibleAgentOutput,
    type AgentPart
} from '$lib/workflow/agent/llm';

const logger = createLogger('task:command');

export interface RunCommandOptions {
    characterId?: string;
    personaId?: string;
}

export async function runCommand(
    chatId: string,
    command: ChatCommand,
    source: string,
    options: RunCommandOptions = {}
): Promise<void> {
    assertCanStartCommand(chatId);

    const [chat, settings] = await Promise.all([getChat(chatId), getAppSettings()]);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
    if (!settings.presetId) throw new AppError('INVALID_INPUT', 'No preset selected');
    assertCanStartCommand(chatId);

    const hasOutput = chatCommandHasOutput(command);
    let messageId: string | undefined;
    let swipeId: string | undefined;
    let preparedMessage: Message | undefined;
    let outputTarget: { message: Message; characterId: string; personaId: string } | undefined;

    if (hasOutput) {
        if (!options.characterId || !options.personaId) {
            throw new AppError('INVALID_INPUT', 'Command output requires a character and persona');
        }

        const room = await getRoom(chat.roomId);
        if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);
        assertCanStartCommand(chatId);
        if (!room.characters.refs[options.characterId]) {
            throw new AppError(
                'INVALID_INPUT',
                `Character is not available: ${options.characterId}`
            );
        }
        if (!chat.personas.refs[options.personaId]) {
            throw new AppError('INVALID_INPUT', `Persona is not available: ${options.personaId}`);
        }

        const targetMessage = await createMessage(chatId, { role: 'assistant' });
        assertCanStartCommand(chatId);
        outputTarget = {
            message: targetMessage,
            characterId: options.characterId,
            personaId: options.personaId
        };
        messageId = outputTarget.message.id;
    }

    const ctx: RuntimeContext = {
        roomId: chat.roomId,
        presetId: settings.presetId,
        characterId: options.characterId,
        personaId: options.personaId,
        chatId
    };
    const controller = new AbortController();
    createCommandTask(command.id, command.name, messageId, controller, {
        roomId: chat.roomId,
        chatId,
        chatTitle: chat.title,
        title: `/${command.name}`
    });

    try {
        let messages: PagedMessages;
        if (outputTarget) {
            messages = await PagedMessages.createBefore(chatId, outputTarget.message.sortOrder);
            const [character, persona] = await Promise.all([
                getCharacter(outputTarget.characterId),
                getPersona(outputTarget.personaId)
            ]);
            if (!character) {
                throw new AppError('NOT_FOUND', `Character not found: ${outputTarget.characterId}`);
            }
            if (!persona) {
                throw new AppError('NOT_FOUND', `Persona not found: ${outputTarget.personaId}`);
            }
            const variables = await getChatVariablesBefore(chatId, outputTarget.message.sortOrder);
            const prepared = await prepareNextSwipe(outputTarget.message, {
                parts: [],
                variables,
                speakerId: character.id,
                speakerName: character.name
            });
            preparedMessage = prepared.message;
            messageId = prepared.message.id;
            swipeId = prepared.swipeId;
        } else {
            const lastMessage = await getLastMessage(chatId);
            messages = lastMessage
                ? await PagedMessages.createThrough(lastMessage)
                : await PagedMessages.createBefore(chatId, '\uffff');
        }

        const runtime = new WorkflowRuntime(command.workflow, {
            ctx,
            localMacros: createCommandMacros(command.name, source),
            messages,
            signal: controller.signal
        });
        let finalParts: AgentPart[] = [];
        for await (const output of runtime.run()) {
            if (!messageId || !swipeId) continue;
            finalParts = deserializeAgentParts(output);
            await updateMessageSwipe(messageId, swipeId, { parts: finalParts });
        }

        if (messageId && swipeId && preparedMessage) {
            if (getLastTextContent(finalParts).length > 0) {
                const outputCtx = toMessageContext(preparedMessage, messages.length, ctx);
                const lastTextIndex = findLastTextIndex(finalParts);
                const lastText = finalParts[lastTextIndex];
                if (lastTextIndex >= 0 && lastText?.type === 'text') {
                    const templated = await runTemplate(lastText.text, outputCtx);
                    const piped = await runPipeline('output', outputCtx, templated);
                    const processed = await runTemplate(piped, outputCtx);
                    finalParts[lastTextIndex] = { type: 'text', text: processed };
                    await updateMessageSwipe(messageId, swipeId, { parts: finalParts });
                }
            }

            const finalMessage = await getMessage(messageId);
            const finalSwipe = finalMessage?.swipes[swipeId];
            if (!finalMessage || !finalSwipe || !hasVisibleAgentOutput(finalSwipe.parts)) {
                throw new AppError('INVALID_INPUT', 'Command workflow produced an empty response');
            }
            void emitEvent(
                'message:received',
                toMessageContext(finalMessage, messages.length, ctx),
                {
                    content: getLastTextContent(finalSwipe.parts)
                }
            );
        }

        setCommandTaskComplete(chatId);
        notifyCommandTaskComplete(command.name);
    } catch (error) {
        if (controller.signal.aborted) {
            clearCommandTask(chatId);
            return;
        }
        const errorMessage = getErrorMessage(error, 'Command workflow failed');
        logger.error(`/${command.name} failed`, error);
        setCommandTaskError(chatId, errorMessage);
        notifyCommandTaskError(command.name, errorMessage);
    }
}

export function stopCommand(chatId: string): void {
    getCommandTask(chatId)?.controller?.abort();
}

export function dismissCommand(chatId: string): void {
    clearCommandTask(chatId);
}

function assertCanStartCommand(chatId: string): void {
    if (
        getChatTask(chatId)?.status === 'generating' ||
        getCommandTask(chatId)?.status === 'generating'
    ) {
        throw new AppError('INVALID_INPUT', `Another chat task is already running: ${chatId}`);
    }
}

function createCommandMacros(commandName: string, source: string): Map<string, Macro> {
    return new Map([
        ['command', createValueMacro('command', commandName)],
        ['source', createValueMacro('source', source)]
    ]);
}

function createValueMacro(name: string, value: string): Macro {
    return {
        recursive: false,
        run: (args) => {
            if (args.length !== 0) {
                throw new AppError('INVALID_INPUT', `{{${name}}} does not accept arguments`);
            }
            return value;
        }
    };
}
