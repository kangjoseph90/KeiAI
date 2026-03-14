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
	'안녕하세요! **KeiAI**의 테스트 봇입니다.\n\n현재 이 메시지는 **스트리밍**으로 전달되고 있으며, 다음과 같은 특징이 있습니다:\n\n* **보안**: 모든 데이터는 E2EE로 암호화됩니다.\n* **로컬**: IndexedDB를 활용한 Local-First 구조입니다.\n* **속도**: 지연 시간이 거의 없는 즉각적인 인터페이스를 지향합니다.',
	'### 시스템 아키텍처 안내\n\nKeiAI는 다음과 같은 기술 스택을 사용합니다:\n\n1. **Frontend**: Svelte 5 (Runes)\n2. **Database**: PocketBase & Local IndexedDB\n3. **Encryption**: AES-256-GCM\n\n질문이 있으시면 언제든 말씀해 주세요!',
	'마크다운 테스트를 위해 **굵은 글씨**, *기울임*, 그리고 `code snippet`을 섞어서 답변을 드립니다.\n\n```typescript\nconst message = "Hello, KeiAI!";\nconsole.log(message);\n```\n\n이렇게 여러 줄의 코드 블록도 문제 없이 렌더링되고 스트리밍되는지 확인해 보세요.',
	'현재 스트리밍되는 텍스트는 **문단 단위**로 페이드인 효과가 적용되고 있습니다.\n\n이 방식은 시각적으로 매우 편안하며 동시에 AI가 실제로 타이핑하는 것과 같은 생동감을 제공합니다. 다음 문단도 한 번 확인해 보세요.\n\n어떠신가요? 블록별로 부드럽게 나타나는 느낌이 잘 살고 있나요?',
	'> "보안은 선택이 아니라 기본입니다."\n\n위와 같은 **인용구**와 함께 긴 답변을 생성해 보겠습니다. KeiAI는 사용자의 프라이버시를 최우선으로 생각하며, 모든 대화 내용은 제3자가 볼 수 없도록 견고하게 설계되었습니다.'
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
