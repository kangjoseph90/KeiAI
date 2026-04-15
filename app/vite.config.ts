import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	envDir: '../',

	resolve: {
		alias: {
			$lib: resolve('./src/lib')
		}
	},

	// Vitest configuration
	test: {
		open: false,
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
		exclude: ['node_modules', 'dist'],
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
		// Tauri v2 uses modern runtimes (WebView2 ≥ Chromium 119, WebKit, modern mobile)
		target:
			process.env.TAURI_ENV_PLATFORM === 'windows'
				? 'chrome119'
				: process.env.TAURI_ENV_PLATFORM === 'android' || process.env.TAURI_ENV_PLATFORM === 'ios'
					? ['es2022', 'chrome119', 'safari17']
					: ['es2022', 'chrome119', 'safari17'],
		// don't minify for debug builds
		minify: !process.env.TAURI_ENV_DEBUG ? true : false,
		// produce sourcemaps for debug builds
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
		rolldownOptions: {
			checks: {
				pluginTimings: false
			}
		}
	}
});
