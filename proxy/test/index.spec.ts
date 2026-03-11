import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Proxy worker', () => {
	describe('Health check', () => {
		it('responds with OK', async () => {
			const request = new IncomingRequest('http://example.com/health');
			const response = await worker.fetch(request, env as any, createExecutionContext());
			await waitOnExecutionContext(createExecutionContext());

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('OK');
		});
	});

	describe('CORS preflight', () => {
		it('handles OPTIONS request with default wildcard', async () => {
			const request = new IncomingRequest('http://example.com/proxy', { method: 'OPTIONS' });
			const response = await worker.fetch(request, {} as any, createExecutionContext());

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		});

		it('matches specific origin from ALLOWED_ORIGINS', async () => {
			const testEnv = { ALLOWED_ORIGINS: 'https://app.keiai.ai, http://localhost:5173' };
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'OPTIONS',
				headers: { Origin: 'https://app.keiai.ai' },
			});
			const response = await worker.fetch(request, testEnv as any, createExecutionContext());

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.keiai.ai');
		});

		it('rejects unknown origin and falls back to first allowed or wildcard', async () => {
			const testEnv = { ALLOWED_ORIGINS: 'https://app.keiai.ai' };
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.com' },
			});
			const response = await worker.fetch(request, testEnv as any, createExecutionContext());

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.keiai.ai');
		});
	});

	describe('Proxy endpoint', () => {
		it('returns 400 when x-target-url is missing', async () => {
			const request = new IncomingRequest('http://example.com/proxy', { method: 'POST' });
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(400);
			expect(await response.text()).toContain('x-target-url');
		});

		it('returns 405 for non-POST requests', async () => {
			const request = new IncomingRequest('http://example.com/proxy', { method: 'GET' });
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(405);
		});

		it('returns 401 when x-proxy-api-key is missing but required', async () => {
			const testEnv = { PROXY_API_KEY: 'secret-key' };
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: { 'x-target-url': 'https://example.com' },
			});
			const response = await worker.fetch(request, testEnv as any, createExecutionContext());

			expect(response.status).toBe(401);
			expect(await response.text()).toContain('Unauthorized');
		});

		it('returns 401 when x-proxy-api-key is incorrect', async () => {
			const testEnv = { PROXY_API_KEY: 'secret-key' };
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': 'https://example.com',
					'x-proxy-api-key': 'wrong-key',
				},
			});
			const response = await worker.fetch(request, testEnv as any, createExecutionContext());

			expect(response.status).toBe(401);
		});

		it('proxies request to target URL with valid key', async () => {
			const testEnv = { PROXY_API_KEY: 'secret-key' };
			const targetUrl = 'https://httpbin.org/post';
			const body = { message: 'hello' };

			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': targetUrl,
					'x-proxy-api-key': 'secret-key',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, testEnv as any, createExecutionContext());

			expect(response.status).toBe(200);
		});

		it('proxies request to target URL (integration)', async () => {
			const targetUrl = 'https://httpbin.org/post';
			const targetHeaders = { 'X-Custom-Header': 'test-value' };
			const body = { message: 'hello from proxy' };

			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': targetUrl,
					'x-target-headers': encodeURIComponent(JSON.stringify(targetHeaders)),
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			const response = await SELF.fetch(request);

			expect(response.ok).toBe(true);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

			const data = (await response.json()) as { headers: Record<string, string>; data: string };
			expect(data.headers['X-Custom-Header']).toBe('test-value');
			expect(JSON.parse(data.data)).toEqual(body);
		});

		it('proxies GET request', async () => {
			const targetUrl = 'https://httpbin.org/get';

			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': targetUrl,
					'x-target-method': 'GET',
					'Content-Type': 'application/json',
				},
			});

			const response = await SELF.fetch(request);

			expect(response.ok).toBe(true);
			const data = (await response.json()) as { url: string };
			expect(data.url).toBe(targetUrl);
		});
	});

	describe('Not found', () => {
		it('returns 404 for unknown paths', async () => {
			const request = new IncomingRequest('http://example.com/unknown');
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(404);
		});
	});
});
