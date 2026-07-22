/**
 * Generic Fetch Proxy for Cloudflare Workers
 *
 * Proxies any HTTP request to a target URL specified in headers.
 * Headers from the original request are forwarded to the target.
 *
 * Usage:
 *   POST /proxy
 *   Headers:
 *     x-target-url: https://api.example.com/endpoint
 *     x-target-method: POST (optional, defaults to POST)
 *     x-target-headers: {"Authorization":"Bearer xxx"} (optional)
 *   Body: <request body to forward>
 */

interface Env {
	ALLOWED_ORIGINS?: string;
}

const PROXY_SPEC = {
	service: 'keiai-proxy',
	protocolVersion: 1,
	capabilities: ['generic-fetch', 'streaming'],
} as const;

// ─── CORS ────────────────────────────────────────────────────────────────────

function resolveOrigin(request: Request, env: Env): string {
	const origin = request.headers.get('Origin');
	const allowedOrigins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()) : [];
	return origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) ? origin : allowedOrigins[0] || '*';
}

function handleCORS(request: Request, env: Env): Response {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': resolveOrigin(request, env),
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
			'Access-Control-Allow-Headers': '*',
			'Access-Control-Max-Age': '86400',
			Vary: 'Origin',
		},
	});
}

function addCorsHeaders(response: Response, request: Request, env: Env): Response {
	const newHeaders = new Headers(response.headers);
	newHeaders.set('Access-Control-Allow-Origin', resolveOrigin(request, env));
	newHeaders.set('Vary', 'Origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}

function corsResponse(body: BodyInit | null, init: ResponseInit, request: Request, env: Env): Response {
	return addCorsHeaders(new Response(body, init), request, env);
}

// ─── SSRF Guard ──────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

const BLOCKED_IP_PREFIXES = [
	'127.', // loopback
	'10.', // private class A
	'192.168.', // private class C
	'169.254.', // link-local / cloud metadata
	'0.', // current network
];

function isBlockedTarget(urlStr: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(urlStr);
	} catch {
		return 'Malformed URL';
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return 'Only http/https targets allowed';
	}

	const hostname = parsed.hostname;

	if (BLOCKED_HOSTNAMES.has(hostname)) {
		return 'Blocked target host';
	}

	if (hostname.startsWith('[')) {
		return 'IPv6 targets not allowed';
	}

	for (const prefix of BLOCKED_IP_PREFIXES) {
		if (hostname.startsWith(prefix)) {
			return 'Internal IP targets not allowed';
		}
	}

	// 172.16.0.0/12 range
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
		return 'Internal IP targets not allowed';
	}

	return null;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return handleCORS(request, env);
		}

		// Health and protocol discovery
		if (url.pathname === '/health') {
			return corsResponse('OK', { status: 200 }, request, env);
		}
		if (url.pathname === '/spec') {
			if (request.method !== 'GET') {
				return corsResponse('Method not allowed. Use GET.', { status: 405 }, request, env);
			}
			return corsResponse(
				JSON.stringify(PROXY_SPEC),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json; charset=utf-8' },
				},
				request,
				env,
			);
		}

		// Proxy endpoint
		if (url.pathname === '/proxy') {
			if (request.method !== 'POST') {
				return corsResponse('Method not allowed. Use POST.', { status: 405 }, request, env);
			}

			const targetUrl = request.headers.get('x-target-url');
			if (!targetUrl) {
				return corsResponse('Missing x-target-url header', { status: 400 }, request, env);
			}

			// 1. SSRF Guard — block internal/private targets
			const blocked = isBlockedTarget(targetUrl);
			if (blocked) {
				return corsResponse(`Forbidden: ${blocked}`, { status: 403 }, request, env);
			}

			// Parse target headers
			let targetHeaders: Record<string, string> = {};
			const targetHeadersStr = request.headers.get('x-target-headers');
			if (targetHeadersStr) {
				try {
					targetHeaders = JSON.parse(decodeURIComponent(targetHeadersStr));
				} catch (e) {
					return corsResponse('Invalid x-target-headers header', { status: 400 }, request, env);
				}
			}

			// Get target method (default to POST)
			const targetMethod = request.headers.get('x-target-method') || 'POST';

			// Forward request to target
			try {
				const proxyResponse = await fetch(targetUrl, {
					method: targetMethod,
					headers: targetHeaders,
					body: request.body,
					// @ts-expect-error - duplex is not in standard typings but required for streaming body
					duplex: 'half',
				});

				return addCorsHeaders(proxyResponse, request, env);
			} catch (error) {
				return corsResponse(`Proxy error: ${error instanceof Error ? error.message : String(error)}`, { status: 502 }, request, env);
			}
		}

		return corsResponse('Not found', { status: 404 }, request, env);
	},
} satisfies ExportedHandler<Env>;
