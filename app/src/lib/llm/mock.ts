/**
 * Mock Stream Provider — Development / Testing
 *
 * Simulates a streaming LLM response for UI development without a real API.
 * Yields the response word-by-word with configurable delay between chunks.
 *
 * Usage:
 *   const provider = new MockStreamProvider([{role: 'user', content: 'Hello'}]);
 *   GenerationManager.generate(chatId, provider);
 */

import type { StreamContent, StreamProvider } from './types';
import type { OpenAIChat } from '$lib/runtime/prompt/types';

const MOCK_RESPONSES = [
	'안녕하세요! 저는 KeiAI의 테스트 봇입니다. 이 메시지는 스트리밍으로 전달되고 있으며, 모든 데이터는 E2EE로 암호화되어 로컬 DB에 저장됩니다.',
	'흥미로운 질문이네요. 저는 생각을 해봤는데, 사실 이 답변 자체가 mock 스트리밍 프로바이더를 통해 단어 단위로 청크를 흘려보내는 방식으로 작동하고 있어요.',
	'Local-First 아키텍처에 대해 말씀드리면, 서버 없이도 완전히 동작하는 앱을 만드는 것이 핵심 목표입니다. 오프라인에서도 암호화된 채팅이 가능하죠.',
	'E2EE란 End-to-End Encryption의 약자로, 데이터가 서버에 저장될 때도 오직 본인만 복호화할 수 있는 방식입니다. AES-256-GCM 알고리즘을 사용해 구현했습니다.',
	'스트리밍이 완료되면 이 메시지는 마스터 키로 암호화되어 IndexedDB에 영구 저장됩니다. 화면에 표시되기 전까지는 평문으로 메모리에만 존재하죠.'
];

export class MockStreamProvider implements StreamProvider {
	private readonly response: string;
	private readonly chunkDelayMs: number;

	constructor(options: { chunkDelayMs?: number } = {}) {
		this.response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
		this.chunkDelayMs = options.chunkDelayMs ?? 60;
	}

	async *stream(messages: OpenAIChat[], signal: AbortSignal): AsyncIterable<StreamContent> {
		const state: StreamContent = {
			content: '',
			thought: ''
		};

		// 1. Simulate "Thought" phase (first 30%)
		state.thought = '질문을 분석하고 적절한 답변을 생성하는 중입니다...';
		yield { ...state };
		await delay(this.chunkDelayMs * 10, signal);

		// 2. Simulate "Content" phase
		const words = this.response.split(' ');
		for (let i = 0; i < words.length; i++) {
			if (signal.aborted) throw new DOMException('AbortError', 'AbortError');

			state.content += (i === 0 ? '' : ' ') + words[i];
			yield { ...state };

			await delay(this.chunkDelayMs, signal);
		}

		// 3. Simulate "Tool Call" phase if messages mention 'tool' or '날씨'
		const promptText = messages.map((m) => m.content).join(' ');
		if (promptText.includes('tool') || promptText.includes('날씨')) {
			state.toolCalls = [
				{
					callId: 'mock_call_' + Math.random().toString(36).slice(2, 9),
					name: 'get_weather',
					args: { location: 'Seoul', unit: 'celsius' }
				}
			];
			yield { ...state };
		}
	}
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new DOMException('AbortError', 'AbortError'));
			},
			{ once: true }
		);
	});
}
