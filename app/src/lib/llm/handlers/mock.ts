/**
 * Mock LLM Stream Handler — Development / Testing
 *
 * Simulates a streaming LLM response for UI development without a real API.
 * Yields the response word-by-word with configurable delay between chunks.
 *
 * Behaviors:
 *   - 'default': Random response from predefined list
 *   - 'echo': Echoes back the last user message
 *   - 'markdown': Returns markdown-heavy response for testing
 *
 * Usage:
 *   const handler = new MockLLMStreamHandler({ behavior: 'echo' });
 *   GenerationManager.generate(chatId, handler);
 */

import {
    getTextContent,
    type LLMStreamOptions,
    type LLMStreamContent,
    type LLMStreamHandler,
    type LLMMessage
} from '../types';
import { debounceStream } from '$lib/utils/stream';
import { abortableSleep } from '$lib/utils/async';
import type { ToolCallRequest } from '$lib/types/tools';

export type MockBehavior = 'default' | 'echo' | 'markdown';

const MOCK_RESPONSES = [
    '안녕하세요! **KeiAI**의 테스트 봇입니다.\n\n현재 이 메시지는 **스트리밍**으로 전달되고 있으며, 다음과 같은 특징이 있습니다:\n\n* **보안**: 모든 데이터는 E2EE로 암호화됩니다.\n* **로컬**: IndexedDB를 활용한 Local-First 구조입니다.\n* **속도**: 지연 시간이 거의 없는 즉각적인 인터페이스를 지향합니다.',
    '### 시스템 아키텍처 안내\n\nKeiAI는 다음과 같은 기술 스택을 사용합니다:\n\n1. **Frontend**: Svelte 5 (Runes)\n2. **Database**: PocketBase & Local IndexedDB\n3. **Encryption**: AES-256-GCM\n\n질문이 있으시면 언제든 말씀해 주세요!',
    '마크다운 테스트를 위해 **굵은 글씨**, *기울임*, 그리고 `code snippet`을 섞어서 답변을 드립니다.\n\n```typescript\nconst message = "Hello, KeiAI!";\nconsole.log(message);\n```\n\n이렇게 여러 줄의 코드 블록도 문제 없이 렌더링되고 스트리밍되는지 확인해 보세요.',
    '현재 스트리밍되는 텍스트는 **문단 단위**로 페이드인 효과가 적용되고 있습니다.\n\n이 방식은 시각적으로 매우 편안하며 동시에 AI가 실제로 타이핑하는 것과 같은 생동감을 제공합니다. 다음 문단도 한 번 확인해 보세요.\n\n어떠신가요? 블록별로 부드럽게 나타나는 느낌이 잘 살고 있나요?',
    '> "보안은 선택이 아니라 기본입니다."\n\n위와 같은 **인용구**와 함께 긴 답변을 생성해 보겠습니다. KeiAI는 사용자의 프라이버시를 최우선으로 생각하며, 모든 대화 내용은 제3자가 볼 수 없도록 견고하게 설계되었습니다.'
];

const MARKDOWN_RESPONSE = `### Markdown 테스트 응답

이 응답은 **마크다운** 렌더링을 테스트하기 위한 것입니다.

#### 텍스트 스타일
*기울임* / **굵게** / ***굵은 기울임*** / ~~취소선~~ / \`인라인 코드\`

#### 목록
1. 첫 번째 항목
2. 두 번째 항목
   - 중첩 항목 A
   - 중첩 항목 B

#### 코드 블록
\`\`\`typescript
interface User {
  id: string;
  name: string;
}

const greet = (user: User): string => \`Hello, \${user.name}!\`;
\`\`\`

#### 인용구
> "좋은 코드는 스스로를 설명한다."
> — 클린 코드 원칙

#### 표
| 기능 | 상태 |
|------|------|
| 스트리밍 | ✅ |
| 마크다운 | ✅ |
| 도구 호출 | ✅ |`;

export interface MockHandlerConfig {
    /** Mock behavior mode. Default: 'default' */
    behavior?: MockBehavior;
    /** Delay between word chunks in ms. Default: 60 */
    chunkDelayMs?: number;
}

export class MockLLMStreamHandler implements LLMStreamHandler {
    private readonly behavior: MockBehavior;
    private readonly chunkDelayMs: number;

    constructor(config: MockHandlerConfig = {}) {
        this.behavior = config.behavior ?? 'default';
        this.chunkDelayMs = config.chunkDelayMs ?? 60;
    }

    async *stream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions = {}
    ): AsyncIterable<LLMStreamContent> {
        const rawStream =
            (options.stream ?? true)
                ? this.rawStream(messages, signal, options)
                : this.complete(messages, options);
        yield* debounceStream(rawStream);
    }

    private getResponse(messages: LLMMessage[]): string {
        const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
        const imageCount = lastUserMessage
            ? lastUserMessage.content.filter((part) => part.type === 'image').length
            : 0;
        if (imageCount > 0) {
            const text = getTextContent(lastUserMessage!.content).trim();
            const attachmentLabel = imageCount === 1 ? 'image attachment' : 'image attachments';
            return [
                `[Mock vision] Received ${imageCount} ${attachmentLabel}.`,
                text ? `Text prompt: ${text}` : ''
            ]
                .filter(Boolean)
                .join('\n\n');
        }

        switch (this.behavior) {
            case 'echo': {
                return lastUserMessage
                    ? getTextContent(lastUserMessage.content)
                    : '(no user message)';
            }
            case 'markdown':
                return MARKDOWN_RESPONSE;
            case 'default':
            default:
                return MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
        }
    }

    private async *rawStream(
        messages: LLMMessage[],
        signal: AbortSignal,
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const state: LLMStreamContent = {
            content: '',
            thought: ''
        };

        // 1. Simulate "Thought" phase (first 30%)
        state.thought = '질문을 분석하고 적절한 답변을 생성하는 중입니다...';
        yield { ...state };
        await abortableSleep(this.chunkDelayMs * 10, signal);

        // 2. Simulate "Content" phase
        const response = this.getResponse(messages);
        const words = response.split(' ');
        for (let i = 0; i < words.length; i++) {
            if (signal.aborted) throw new DOMException('AbortError', 'AbortError');

            state.content += (i === 0 ? '' : ' ') + words[i];
            yield { ...state };

            await abortableSleep(this.chunkDelayMs, signal);
        }

        // 3. Simulate a file tool call when the latest user message asks for one.
        const toolCall = getMockToolCall(messages, options);
        if (toolCall) {
            state.toolCalls = [toolCall];
            yield { ...state };
        }
    }

    private async *complete(
        messages: LLMMessage[],
        options: LLMStreamOptions
    ): AsyncIterable<LLMStreamContent> {
        const state: LLMStreamContent = {
            content: this.getResponse(messages),
            thought: '질문을 분석하고 적절한 답변을 생성했습니다.'
        };
        const toolCall = getMockToolCall(messages, options);
        if (toolCall) {
            state.toolCalls = [toolCall];
        }
        yield state;
    }
}

function getMockToolCall(
    messages: LLMMessage[],
    options: LLMStreamOptions
): ToolCallRequest | null {
    const lastMessage = messages.at(-1);
    if (lastMessage?.role !== 'user') return null;

    const prompt = getTextContent(lastMessage.content).trim();
    const toolName = getRequestedFileTool(prompt);
    if (!toolName) return null;

    const tool = options.tools?.find((candidate) => candidate.name === toolName);
    if (!tool) return null;
    const args = Object.fromEntries(
        Object.entries(tool.inputSchema.properties).map(([name, schema]) => {
            if (name === 'namespace') return [name, getMockFileNamespace(prompt)];
            if (name === 'path') return [name, getMockFilePath(prompt)];
            if (name === 'content') return [name, getMockFileContent(prompt)];
            if (schema.enum?.length) return [name, schema.enum[0]];
            if (schema.type === 'number') return [name, 0];
            if (schema.type === 'boolean') return [name, false];
            return [name, 'mock'];
        })
    );
    return {
        callId: `mock_call_${Math.random().toString(36).slice(2, 9)}`,
        name: tool.name,
        args
    };
}

function getRequestedFileTool(prompt: string): 'file_read' | 'file_write' | null {
    if (!prompt) return null;
    if (
        /\b(?:write|save|create|update|overwrite)\b|(?:저장|작성|생성|수정|덮어쓰|써\s*줘)/iu.test(
            prompt
        )
    ) {
        return 'file_write';
    }
    if (/\b(?:read|open|load|show)\b|(?:읽어|열어|불러|보여\s*줘)/iu.test(prompt)) {
        return 'file_read';
    }
    return null;
}

function getMockFileNamespace(prompt: string): 'global' | 'room' | 'chat' {
    if (/\bglobal\b|전역/iu.test(prompt)) return 'global';
    if (/\broom\b|(?:채팅)?방/iu.test(prompt)) return 'room';
    return 'chat';
}

function getMockFilePath(prompt: string): string {
    return (
        prompt.match(/[\p{L}\p{N}_.-]+(?:[\\/][\p{L}\p{N}_.-]+)*\.[a-z0-9]+/iu)?.[0] ?? 'mock.txt'
    );
}

function getMockFileContent(prompt: string): string {
    const path = getMockFilePath(prompt);
    const quoted = [...prompt.matchAll(/["'`](.+?)["'`]/g)]
        .map((match) => match[1].trim())
        .find((value) => value && value !== path);
    return quoted ?? 'Mock tool content';
}
