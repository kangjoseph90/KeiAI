/**
 * Download Tokenizer Data — KeiAI
 *
 * Downloads tokenizer vocab/model files from HuggingFace Hub.
 * Runs automatically via `pnpm install` (postinstall hook).
 * Files are saved to static/token/ and gitignored.
 *
 * Usage: node scripts/download-tokens.js [--force]
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public', 'token');

/** @type {Array<{ outPath: string, url: string }>} */
const FILES = [
	// OpenAI — o200k_base (via Xenova/gpt-4o)
	{
		outPath: 'o200k_base/tokenizer.json',
		url: 'https://huggingface.co/Xenova/gpt-4o/resolve/main/tokenizer.json'
	},
	// Anthropic — Claude (via Xenova/claude-tokenizer)
	{
		outPath: 'claude/tokenizer.json',
		url: 'https://huggingface.co/Xenova/claude-tokenizer/resolve/main/tokenizer.json'
	},
	// Meta — Llama 3 (via NousResearch, ungated)
	{
		outPath: 'llama3/tokenizer.json',
		url: 'https://huggingface.co/NousResearch/Meta-Llama-3-8B/resolve/main/tokenizer.json'
	},
	// DeepSeek
	{
		outPath: 'deepseek/tokenizer.json',
		url: 'https://huggingface.co/deepseek-ai/DeepSeek-V3/resolve/main/tokenizer.json'
	},
	// Google — Gemma (SentencePiece for Web, JSON for Tauri; via unsloth, ungated)
	{
		outPath: 'gemma/tokenizer.model',
		url: 'https://huggingface.co/unsloth/gemma-2-2b/resolve/main/tokenizer.model'
	},
	{
		outPath: 'gemma/tokenizer.json',
		url: 'https://huggingface.co/unsloth/gemma-2-2b/resolve/main/tokenizer.json'
	},
	// Mistral (SentencePiece for Web, JSON for Tauri)
	{
		outPath: 'mistral/tokenizer.model',
		url: 'https://huggingface.co/mistralai/Mistral-7B-v0.1/resolve/main/tokenizer.model'
	},
	{
		outPath: 'mistral/tokenizer.json',
		url: 'https://huggingface.co/mistralai/Mistral-7B-v0.1/resolve/main/tokenizer.json'
	}
];

const force = process.argv.includes('--force');

async function download(file) {
	const dest = join(PUBLIC_DIR, file.outPath);

	if (!force && existsSync(dest)) {
		console.log(`  ✓ ${file.outPath} (cached)`);
		return;
	}

	mkdirSync(dirname(dest), { recursive: true });

	console.log(`  ↓ ${file.outPath}...`);
	const res = await fetch(file.url);
	if (!res.ok) {
		console.error(`  ✗ ${file.outPath} — HTTP ${res.status}`);
		return;
	}

	const buffer = Buffer.from(await res.arrayBuffer());
	writeFileSync(dest, buffer);
	console.log(`  ✓ ${file.outPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

async function main() {
	console.log('📦 Downloading tokenizer data...');
	console.log(`   Target: ${PUBLIC_DIR}\n`);

	for (const file of FILES) {
		await download(file);
	}

	console.log('\n✅ Done.');
}

main().catch((err) => {
	console.error('Failed to download tokenizer data:', err);
	process.exit(1);
});
