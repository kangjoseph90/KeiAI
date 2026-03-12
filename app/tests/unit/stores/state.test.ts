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
	runtimeTasks,
	chatTaskIds,
	activeChat,
	displayMessages,
	isGenerating
} from '$lib/stores/state';
import type { AppSettings, Profile, ChatDetail, Message } from '$lib/services';
import type { RuntimeTask } from '$lib/stores/types';

describe('Global Stores', () => {
	beforeEach(() => {
		// Reset stores to default state
		appSettings.set(null);
		activeUser.set(null);
		pbConnected.set(false);
		messages.set([]);
		runtimeTasks.set(new Map());
		chatTaskIds.set(new Map());
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
			const taskId = 'task-1';
			activeChat.set({ id: chatId } as ChatDetail);

			chatTaskIds.set(new Map([[chatId, taskId]]));
			runtimeTasks.set(
				new Map<string, RuntimeTask>([
					[
						taskId,
						{ id: taskId, status: 'generating', content: '...', meta: { kind: 'chat', chatId } }
					]
				])
			);

			expect(get(isGenerating)).toBe(true);
		});

		it('should not indicate generation for different chat', () => {
			const taskId = 'task-2';
			activeChat.set({ id: 'chat-1' } as ChatDetail);

			chatTaskIds.set(new Map([['chat-2', taskId]]));
			runtimeTasks.set(
				new Map<string, RuntimeTask>([
					[
						taskId,
						{
							id: taskId,
							status: 'generating',
							content: '...',
							meta: { kind: 'chat', chatId: 'chat-2' }
						}
					]
				])
			);

			expect(get(isGenerating)).toBe(false);
		});
	});

	describe('Display Messages (Derived)', () => {
		it('should merge messages and active generation task', () => {
			const chatId = 'chat-1';
			const taskId = 'task-1';
			activeChat.set({ id: chatId } as ChatDetail);

			const dbMessages: Message[] = [
				{ id: 'm1', chatId, role: 'user', content: 'hello', sortOrder: 'a' } as Message
			];
			messages.set(dbMessages);

			chatTaskIds.set(new Map([[chatId, taskId]]));
			runtimeTasks.set(
				new Map<string, RuntimeTask>([
					[
						taskId,
						{ id: taskId, status: 'generating', content: 'world', meta: { kind: 'chat', chatId } }
					]
				])
			);

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
			chatTaskIds.set(new Map());

			const display = get(displayMessages);
			expect(display).toHaveLength(1);
			expect(display[0].id).toBe('m1');
		});
	});
});
