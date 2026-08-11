import { describe, expect, it } from 'vitest';
import type { Module, Preset } from '$lib/services';
import type { ChatCommand, ResolvedChatCommand } from '$lib/types/command';
import {
    chatCommandHasOutput,
    filterChatCommands,
    getChatCommandQuery,
    normalizeChatCommandName,
    parseChatCommand,
    resolveChatCommands
} from '$lib/managers/command';

function command(name: string, overrides: Partial<ChatCommand> = {}): ChatCommand {
    return {
        id: name,
        name,
        description: '',
        workflow: { nodes: {} },
        sortOrder: name,
        ...overrides
    };
}

describe('chat commands', () => {
    const commands = [command('compact'), command('roll'), command('remember')];
    const resolved = commands.slice(0, 2).map(
        (item): ResolvedChatCommand => ({
            owner: { type: 'preset', id: 'preset-1' },
            ownerName: 'Preset',
            command: item
        })
    );

    it('normalizes command names written in Unicode scripts', () => {
        expect(normalizeChatCommandName('/압축')).toBe('압축');
        expect(normalizeChatCommandName('ÄNDERUNG')).toBe('änderung');
        expect(normalizeChatCommandName('e\u0301dit')).toBe('édit');
        expect(() => normalizeChatCommandName('두 단어')).toThrow(
            'Command names must use letters, numbers, hyphens, or underscores'
        );
    });

    it('filters and parses Unicode command names', () => {
        const unicode = {
            owner: { type: 'module' as const, id: 'module-1' },
            ownerName: '도구',
            command: command('압축')
        };

        expect(filterChatCommands([unicode], '압')).toEqual([unicode]);
        expect(parseChatCommand('/압축 최근 대화', [unicode])).toEqual({
            resolved: unicode,
            source: '최근 대화'
        });
    });

    it('opens suggestions only for the leading command token', () => {
        expect(getChatCommandQuery('/')).toBe('');
        expect(getChatCommandQuery('/co')).toBe('co');
        expect(getChatCommandQuery('/compact arg')).toBeNull();
        expect(getChatCommandQuery('hello /co')).toBeNull();
    });

    it('filters commands by prefix', () => {
        expect(filterChatCommands(resolved, '')).toEqual(resolved);
        expect(filterChatCommands(resolved, 'co')).toEqual([resolved[0]]);
        expect(filterChatCommands(resolved, 'rem')).toEqual([]);
    });

    it('parses an exact command and preserves its raw argument text', () => {
        expect(parseChatCommand('/compact   keep this', resolved)).toEqual({
            resolved: resolved[0],
            source: 'keep this'
        });
        expect(parseChatCommand('/unknown', resolved)).toBeNull();
        expect(parseChatCommand('/remember', resolved)).toBeNull();
    });

    it('resolves preset commands before active modules and exposes the owner name', () => {
        const preset = {
            id: 'preset-1',
            name: 'Roleplay',
            commands: {
                refs: { compact: command('compact'), off: command('off') },
                folders: {}
            }
        } as unknown as Preset;
        const module = {
            id: 'module-1',
            name: 'Memory Tools',
            commands: {
                refs: { compact: command('compact'), remember: command('remember') },
                folders: {}
            }
        } as unknown as Module;

        expect(resolveChatCommands(preset, [module])).toEqual([
            expect.objectContaining({
                ownerName: 'Roleplay',
                command: preset.commands.refs.compact
            }),
            expect.objectContaining({
                ownerName: 'Roleplay',
                command: preset.commands.refs.off
            }),
            expect.objectContaining({
                ownerName: 'Memory Tools',
                command: module.commands.refs.remember
            })
        ]);
    });

    it('detects whether a command has any Output node', () => {
        const withOutput = command('answer', {
            workflow: {
                nodes: {
                    output: {
                        id: 'output',
                        name: 'Output',
                        class: 'Output',
                        position: { x: 0, y: 0 },
                        collapsed: false,
                        inputs: { content: null },
                        inputValues: { content: '' }
                    }
                }
            }
        });
        expect(chatCommandHasOutput(withOutput)).toBe(true);
        expect(chatCommandHasOutput(commands[0])).toBe(false);
    });
});
