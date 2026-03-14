/**
 * Tokenizer Worker — KeiAI
 *
 * Web Worker that performs tokenization for all supported encodings
 * using @mlc-ai/web-tokenizers (HuggingFace JSON vocab / SentencePiece).
 *
 * Each tokenizer instance is lazy-loaded on first use and cached.
 * Token data files are fetched from /token/ (static assets).
 */

import { expose } from 'comlink';
import type { TokenizerEncoding } from '$lib/shared/models';

// ─── Encoder Interface ───────────────────────────────────────────────────────

interface Encoder {
	encode(text: string): { length: number };
}

// ─── Instance Cache ──────────────────────────────────────────────────────────

const cache = new Map<TokenizerEncoding, Encoder>();

// ─── Tokenizer Specs ─────────────────────────────────────────────────────────

type LoadKind = 'json' | 'sentencepiece';

const SPECS: Record<TokenizerEncoding, { kind: LoadKind; path: string }> = {
	o200k_base: { kind: 'json', path: '/token/o200k_base/tokenizer.json' },
	claude: { kind: 'json', path: '/token/claude/tokenizer.json' },
	llama3: { kind: 'json', path: '/token/llama3/tokenizer.json' },
	deepseek: { kind: 'json', path: '/token/deepseek/tokenizer.json' },
	gemma: { kind: 'sentencepiece', path: '/token/gemma/tokenizer.model' },
	mistral: { kind: 'sentencepiece', path: '/token/mistral/tokenizer.model' }
};

// ─── Loader ──────────────────────────────────────────────────────────────────

async function load(kind: LoadKind, path: string): Promise<Encoder> {
	const { Tokenizer } = await import('@mlc-ai/web-tokenizers');
	const buf = await (await fetch(path)).arrayBuffer();
	return kind === 'json' ? Tokenizer.fromJSON(buf) : Tokenizer.fromSentencePiece(buf);
}

// ─── Resolver ────────────────────────────────────────────────────────────────

async function getEncoder(encoding: TokenizerEncoding): Promise<Encoder> {
	const cached = cache.get(encoding);
	if (cached) return cached;

	const spec = SPECS[encoding];
	const encoder = await load(spec.kind, spec.path);
	cache.set(encoding, encoder);
	return encoder;
}

// ─── Worker Class ────────────────────────────────────────────────────────────

class TokenizerWorker {
	async count(text: string, encoding: TokenizerEncoding): Promise<number> {
		const encoder = await getEncoder(encoding);
		return encoder.encode(text).length;
	}
}

// ─── Expose via Comlink ─────────────────────────────────────────────────────

expose(new TokenizerWorker());
