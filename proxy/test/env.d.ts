declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		ALLOWED_ORIGINS?: string;
	}
}
