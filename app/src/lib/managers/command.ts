import type { Module, Preset } from '$lib/services';
import type { ChatCommand, ResolvedChatCommand } from '$lib/types/command';
import { AppError } from '$lib/types/errors';
import { listItems } from '$lib/utils/ordering';

const CHAT_COMMAND_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*$/u;

export interface ParsedChatCommand {
    resolved: ResolvedChatCommand;
    source: string;
}

export function chatCommandNameKey(value: string): string {
    return value.normalize('NFC').toLowerCase();
}

export function normalizeChatCommandName(value: string): string {
    const name = chatCommandNameKey(value.trim().replace(/^\/+/, ''));
    if (!CHAT_COMMAND_NAME_PATTERN.test(name)) {
        throw new AppError(
            'INVALID_INPUT',
            'Command names must use letters, numbers, hyphens, or underscores'
        );
    }
    return name;
}

export function createUnusedChatCommandName(commands: readonly ChatCommand[]): string {
    const names = new Set(commands.map((command) => chatCommandNameKey(command.name)));
    if (!names.has('command')) return 'command';
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `command-${suffix}`;
        if (!names.has(candidate)) return candidate;
    }
}

export function resolveChatCommands(
    preset: Preset | null | undefined,
    activeModules: readonly Module[]
): ResolvedChatCommand[] {
    if (!preset) return [];

    const resolved: ResolvedChatCommand[] = [];
    const names = new Set<string>();
    const addOwner = (
        owner: ResolvedChatCommand['owner'],
        ownerName: string,
        commands: readonly ChatCommand[]
    ) => {
        for (const command of commands) {
            const name = chatCommandNameKey(command.name);
            if (names.has(name)) continue;
            names.add(name);
            resolved.push({ owner, ownerName, command });
        }
    };

    addOwner({ type: 'preset', id: preset.id }, preset.name, listItems(preset.commands));
    for (const module of activeModules) {
        addOwner({ type: 'module', id: module.id }, module.name, listItems(module.commands));
    }
    return resolved;
}

export function getChatCommandQuery(input: string): string | null {
    if (!input.startsWith('/')) return null;
    const token = input.slice(1);
    if (/\s/.test(token)) return null;
    return chatCommandNameKey(token);
}

export function filterChatCommands(
    commands: readonly ResolvedChatCommand[],
    query: string | null
): ResolvedChatCommand[] {
    if (query === null) return [];
    return commands.filter(({ command }) => chatCommandNameKey(command.name).startsWith(query));
}

export function parseChatCommand(
    input: string,
    commands: readonly ResolvedChatCommand[]
): ParsedChatCommand | null {
    if (!input.startsWith('/')) return null;
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(input);
    if (!match) return null;
    const name = chatCommandNameKey(match[1]);
    const resolved = commands.find(({ command }) => chatCommandNameKey(command.name) === name);
    return resolved ? { resolved, source: match[2] ?? '' } : null;
}

export function chatCommandHasOutput(command: ChatCommand): boolean {
    return Object.values(command.workflow.nodes).some((node) => node.class === 'Output');
}
