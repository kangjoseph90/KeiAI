/**
 * Asset Utilities — KeiAI v2
 *
 * Image processing, hashing, and encryption utilities.
 */

import { MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, WEBP_QUALITY } from './types';
import { CDN_BASE_URL, FIXED_SALT } from '$lib/config';
import { sha256, fromHex, encryptBytes, decryptBytes, type Bytes } from '$lib/crypto';

// ─── Image Loading & Resizing ─────────────────────────────────────────────

function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));
		img.src = URL.createObjectURL(file);
	});
}

function calculateDimensions(
	width: number,
	height: number,
	maxWidth: number,
	maxHeight: number
): { width: number; height: number } {
	if (width <= maxWidth && height <= maxHeight) {
		return { width, height };
	}

	const widthRatio = maxWidth / width;
	const heightRatio = maxHeight / height;
	const ratio = Math.min(widthRatio, heightRatio);

	return {
		width: Math.round(width * ratio),
		height: Math.round(height * ratio)
	};
}

// ─── WebP Compression ─────────────────────────────────────────────────────

function compressToWebP(
	img: HTMLImageElement,
	quality: number,
	width: number,
	height: number
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d');

		if (!ctx) {
			reject(new Error('Failed to get canvas context'));
			return;
		}

		ctx.drawImage(img, 0, 0, width, height);

		canvas.convertToBlob({ type: 'image/webp', quality }).then(resolve).catch(reject);
	});
}

// ─── Public Functions ─────────────────────────────────────────────────────

/**
 * Ensures the image is a compliant WebP within size limits.
 * Returns the processed Blob and its dimensions.
 * If already compliant, returns original file.
 */
export async function preprocessImage(
	file: File
): Promise<{ blob: Blob; width: number; height: number }> {
	const img = await loadImage(file);
	const originalWidth = img.width;
	const originalHeight = img.height;

	const isCompliant =
		file.type === 'image/webp' &&
		originalWidth <= MAX_IMAGE_WIDTH &&
		originalHeight <= MAX_IMAGE_HEIGHT;

	if (isCompliant) {
		return { blob: file, width: originalWidth, height: originalHeight };
	}

	const dims = calculateDimensions(
		originalWidth,
		originalHeight,
		MAX_IMAGE_WIDTH,
		MAX_IMAGE_HEIGHT
	);
	const blob = await compressToWebP(img, WEBP_QUALITY, dims.width, dims.height);

	return { blob, width: dims.width, height: dims.height };
}

/**
 * Derive encryption key from plaintext bytes: SHA256(bytes + FIXED_SALT)
 */
export async function deriveAssetKey(bytes: Uint8Array): Promise<string> {
	const saltBytes = new TextEncoder().encode(FIXED_SALT);
	const combined = new Uint8Array(bytes.length + saltBytes.length);
	combined.set(bytes);
	combined.set(saltBytes, bytes.length);
	return await sha256(combined);
}

/**
 * Encrypt asset data using AES-GCM.
 */
export async function encryptAsset(
	data: Uint8Array | ArrayBuffer,
	keyHex: string
): Promise<Uint8Array> {
	const keyBytes = fromHex(keyHex);
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		keyBytes.buffer as ArrayBuffer,
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);

	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	const { ciphertext, iv } = await encryptBytes(cryptoKey, bytes as unknown as Bytes);

	const result = new Uint8Array(iv.length + ciphertext.length);
	result.set(iv);
	result.set(ciphertext, iv.length);

	return result;
}

/**
 * Decrypt AES-GCM bytes using key.
 */
export async function decryptAsset(
	encryptedBytes: Uint8Array,
	keyHex: string
): Promise<Uint8Array> {
	const keyBytes = fromHex(keyHex);
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		keyBytes.buffer as ArrayBuffer,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const iv = encryptedBytes.slice(0, 12);
	const ciphertext = encryptedBytes.slice(12);

	return await decryptBytes(cryptoKey, {
		ciphertext: ciphertext as unknown as Bytes,
		iv: iv as unknown as Bytes
	});
}

/** Check if bytes start with a valid image magic number */
export function isValidImageHeader(bytes: Uint8Array): boolean {
	if (bytes.length < 4) return false;

	const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
	const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	const isWebP =
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes.length >= 12 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50;
	const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;

	return isPng || isJpeg || isWebP || isGif;
}

export function getRemoteURL(hash: string): string {
	return `${CDN_BASE_URL}/assets/${hash}`;
}
