import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],

	// Vitest configuration
	test: {
		open: false,
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
		exclude: ['node_modules', '.svelte-kit', 'dist'],
		environment: 'happy-dom',
		environmentOptions: {
			happyDom: {
				url: 'http://localhost:5173'
			}
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.{js,ts,svelte}'],
			exclude: ['src/**/*.test.{js,ts}', 'src/**/*.spec.{js,ts}', 'src/**/*.d.ts']
		},
		setupFiles: ['./tests/setup.ts'],
		ui: true
	},

	// Tauri: don't open a browser window automatically
	clearScreen: false,

	server: {
		// Tauri expects a fixed port; fail if not available
		strictPort: true,
		host: host || false,
		port: 5173
	},

	envPrefix: ['VITE_', 'TAURI_ENV_*'],

	build: {
		// Tauri uses Chromium on Windows and WebKit on macOS and Linux
		target:
			process.env.TAURI_ENV_PLATFORM === 'windows'
				? 'chrome105'
				: process.env.TAURI_ENV_PLATFORM === 'android' || process.env.TAURI_ENV_PLATFORM === 'ios'
					? ['es2021', 'chrome100', 'safari13']
					: ['es2021', 'chrome100', 'safari13'],
		// don't minify for debug builds
		minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
		// produce sourcemaps for debug builds
		sourcemap: !!process.env.TAURI_ENV_DEBUG
	}
});
