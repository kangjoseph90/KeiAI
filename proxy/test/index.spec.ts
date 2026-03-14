import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Proxy worker', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

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

		it('proxies request to target URL', async () => {
			const targetUrl = 'https://httpbin.org/post';
			const body = { message: 'hello' };

			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': targetUrl,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			const response = await worker.fetch(request, {} as any, createExecutionContext());

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
			expect(response.headers.has('Access-Control-Allow-Origin')).toBe(true);

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

	describe('Proxy endpoint error handling', () => {
		it('returns 400 for malformed JSON in x-target-headers', async () => {
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': 'https://example.com',
					'x-target-headers': 'invalid-json',
				},
			});
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(400);
			expect(await response.text()).toContain('Invalid x-target-headers');
		});

		it('returns 502 when target fetch fails', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection failed'));

			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': 'https://example.com',
				},
			});
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(502);
			expect(await response.text()).toContain('Proxy error: Connection failed');

			fetchSpy.mockRestore();
		});
	});

	describe('SSRF protection', () => {
		it('blocks localhost targets', async () => {
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: { 'x-target-url': 'http://localhost/admin' },
			});
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(403);
			expect(await response.text()).toContain('Blocked target host');
		});

		it('blocks loopback IP targets', async () => {
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: { 'x-target-url': 'http://127.0.0.1:8090/api' },
			});
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(403);
			expect(await response.text()).toContain('Internal IP');
		});

		it('blocks cloud metadata endpoints', async () => {
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: { 'x-target-url': 'http://169.254.169.254/latest/meta-data/' },
			});
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).toBe(403);
		});

		it('blocks private network IPs', async () => {
			const targets = ['http://10.0.0.1/api', 'http://192.168.1.1/', 'http://172.16.0.1/'];

			for (const target of targets) {
				const request = new IncomingRequest('http://example.com/proxy', {
					method: 'POST',
					headers: { 'x-target-url': target },
				});
				const response = await worker.fetch(request, env as any, createExecutionContext());
				expect(response.status).toBe(403);
			}
		});

		it('allows legitimate external targets', async () => {
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: { 'x-target-url': 'https://api.openai.com/v1/chat/completions' },
			});
			const response = await worker.fetch(request, env as any, createExecutionContext());

			expect(response.status).not.toBe(403);
		});
	});

	describe('CORS reinforcement', () => {
		it('adds CORS headers to successful proxy responses', async () => {
			const targetUrl = 'https://httpbin.org/get';
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': targetUrl,
					'x-target-method': 'GET',
					Origin: 'http://localhost:5173',
				},
			});

			const testEnv = { ALLOWED_ORIGINS: 'http://localhost:5173' };
			const response = await worker.fetch(request, testEnv as any, createExecutionContext());

			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
			expect(response.headers.get('Vary')).toBe('Origin');
		});

		it('defaults to * when ALLOWED_ORIGINS is not set', async () => {
			const request = new IncomingRequest('http://example.com/proxy', {
				method: 'POST',
				headers: {
					'x-target-url': 'https://httpbin.org/get',
					'x-target-method': 'GET',
				},
			});

			const response = await worker.fetch(request, {} as any, createExecutionContext());
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
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
