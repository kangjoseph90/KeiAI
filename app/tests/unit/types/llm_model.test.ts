import { describe, expect, it } from 'vitest';
import {
    ALL_LLM_CAPABILITIES,
    TRANSFORMERS_LLM_MODELS,
    getBuiltInLLMModels
} from '$lib/types/models/llm';

describe('LLM model capabilities', () => {
    it('declares positive capabilities for every built-in model', () => {
        for (const provider of [
            'openai',
            'anthropic',
            'deepseek',
            'google',
            'mistral',
            'mock'
        ] as const) {
            for (const model of getBuiltInLLMModels(provider)) {
                expect(model.capabilities).toBeDefined();
                expect(
                    model.capabilities.every((item) => ALL_LLM_CAPABILITIES.includes(item))
                ).toBe(true);
            }
        }
    });

    it('keeps provider and local-runtime capability contracts explicit', () => {
        expect(getBuiltInLLMModels('openai')[0]?.capabilities).toEqual([
            'image_input',
            'audio_input',
            'file_input',
            'streaming',
            'tool_call'
        ]);
        expect(getBuiltInLLMModels('deepseek')[0]?.capabilities).toEqual([
            'streaming',
            'tool_call'
        ]);
        expect(TRANSFORMERS_LLM_MODELS.map((model) => model.capabilities)).toEqual([
            ['streaming'],
            ['streaming'],
            ['image_input', 'audio_input', 'streaming'],
            ['image_input', 'audio_input', 'streaming'],
            ['image_input', 'streaming'],
            ['image_input', 'streaming']
        ]);
    });
});
