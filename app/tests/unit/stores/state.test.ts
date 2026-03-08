/**
 * Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	appSettings,
	activeUser,
	pbConnected,
	isLoggedIn,
	messages,
	generationTasks,
	activeChat,
	displayMessages,
	isGenerating
} from '$lib/stores/state';
import type { AppSettings, Profile, ChatDetail, Message } from '$lib/services';
import type { GenerationTask } from '$lib/stores/types';

describe('Global Stores', () => {
	beforeEach(() => {
		// Reset stores to default state
		appSettings.set(null);
		activeUser.set(null);
		pbConnected.set(false);
		messages.set([]);
		generationTasks.set(new Map());
		activeChat.set(null);
	});

	describe('Authentication State (Derived)', () => {
		it('should be logged in when user exists, is not guest, and pb is connected', () => {
			activeUser.set({ id: 'u1', isGuest: false } as Profile);
			pbConnected.set(true);
			expect(get(isLoggedIn)).toBe(true);
		});

		it('should not be logged in if user is guest', () => {
			activeUser.set({ id: 'u1', isGuest: true } as Profile);
			pbConnected.set(true);
			expect(get(isLoggedIn)).toBe(false);
		});

		it('should not be logged in if pb is disconnected', () => {
			activeUser.set({ id: 'u1', isGuest: false } as Profile);
			pbConnected.set(false);
			expect(get(isLoggedIn)).toBe(false);
		});
	});

	describe('Generation State (Derived)', () => {
		it('should indicate generation is running for active chat', () => {
			const chatId = 'chat-1';
			activeChat.set({ id: chatId } as ChatDetail);
			const tasks = new Map<string, GenerationTask>();
			tasks.set(chatId, {
				content: '...',
				status: 'generating',
				abortController: new AbortController()
			});
			generationTasks.set(tasks);

			expect(get(isGenerating)).toBe(true);
		});

		it('should not indicate generation for different chat', () => {
			activeChat.set({ id: 'chat-1' } as ChatDetail);
			const tasks = new Map<string, GenerationTask>();
			tasks.set('chat-2', {
				content: '...',
				status: 'generating',
				abortController: new AbortController()
			});
			generationTasks.set(tasks);

			expect(get(isGenerating)).toBe(false);
		});
	});

	describe('Display Messages (Derived)', () => {
		it('should merge messages and active generation task', () => {
			const chatId = 'chat-1';
			activeChat.set({ id: chatId } as ChatDetail);

			const dbMessages: Message[] = [
				{ id: 'm1', chatId, role: 'user', content: 'hello', sortOrder: 'a' } as Message
			];
			messages.set(dbMessages);

			const tasks = new Map<string, GenerationTask>();
			tasks.set(chatId, {
				content: 'world',
				status: 'generating',
				abortController: new AbortController()
			});
			generationTasks.set(tasks);

			const display = get(displayMessages);

			expect(display).toHaveLength(2);
			expect(display[0].id).toBe('m1');
			expect(display[0].displayStatus).toBe('completed');
			expect(display[1].id).toBe('__generating_chat-1');
			expect(display[1].content).toBe('world');
			expect(display[1].displayStatus).toBe('generating');
		});

		it('should only show DB messages if no generation task', () => {
			const chatId = 'chat-1';
			activeChat.set({ id: chatId } as ChatDetail);
			messages.set([{ id: 'm1' } as Message]);
			generationTasks.set(new Map());

			const display = get(displayMessages);
			expect(display).toHaveLength(1);
			expect(display[0].id).toBe('m1');
		});
	});
});
