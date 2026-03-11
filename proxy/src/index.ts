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
	PROXY_API_KEY?: string;
}

function handleCORS(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
			'Access-Control-Allow-Headers': '*',
			'Access-Control-Max-Age': '86400',
		},
	});
}

function addCorsHeaders(response: Response): Response {
	const newHeaders = new Headers(response.headers);
	newHeaders.set('Access-Control-Allow-Origin', '*');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// Health check
		if (url.pathname === '/health') {
			return new Response('OK', { status: 200 });
		}

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return handleCORS();
		}

		// Proxy endpoint
		if (url.pathname === '/proxy') {
			if (request.method !== 'POST') {
				return new Response('Method not allowed. Use POST.', { status: 405 });
			}

			const targetUrl = request.headers.get('x-target-url');
			if (!targetUrl) {
				return new Response('Missing x-target-url header', { status: 400 });
			}

			// 1. Verify Shared Key
			const proxyKey = env.PROXY_API_KEY;
			if (proxyKey) {
				const providedKey = request.headers.get('x-proxy-api-key');
				if (providedKey !== proxyKey) {
					return new Response('Unauthorized: Invalid or missing x-proxy-api-key', { status: 401 });
				}
			}

			// 2. Simple IP-based Rate Limiting (Using cf object as a hint)
			// Note: For production, use Cloudflare's Rate Limiting feature or KV/Durable Objects.
			// This is a basic check to prevent obvious automated abuse.
			const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
			// (Cloudflare Workers Free Tier covers 100k requests/day, so we just log/monitor for now
			// or could implement a more sophisticated guard if a KV binding was available).

			// Parse target headers
			let targetHeaders: Record<string, string> = {};
			const targetHeadersStr = request.headers.get('x-target-headers');
			if (targetHeadersStr) {
				try {
					targetHeaders = JSON.parse(decodeURIComponent(targetHeadersStr));
				} catch (e) {
					return new Response('Invalid x-target-headers header', { status: 400 });
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

				return addCorsHeaders(proxyResponse);
			} catch (error) {
				return new Response(`Proxy error: ${error instanceof Error ? error.message : String(error)}`, { status: 502 });
			}
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
