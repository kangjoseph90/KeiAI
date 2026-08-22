import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
    plugins: [
        tailwindcss(),
        svelte(),
        VitePWA({
            registerType: 'autoUpdate',
            // Registration happens in src/main.ts so it can be skipped inside Tauri
            injectRegister: false,
            manifest: {
                id: '/',
                name: 'KeiAI',
                short_name: 'KeiAI',
                description: 'Local-first AI character chat',
                display: 'standalone',
                theme_color: '#101014',
                background_color: '#ffffff',
                icons: [
                    { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
                    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                    {
                        src: 'maskable-icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            workbox: {
                // Precache only what a cold offline boot needs (index.html module
                // graph + icons); inference workers and wasm (~60 MB) are cached
                // on demand through runtimeCaching below
                globPatterns: [
                    'index.html',
                    'assets/index-*.js',
                    'assets/index-*.css',
                    'assets/preload-helper-*.js',
                    'favicon.ico',
                    'pwa-*.png',
                    'maskable-icon-512x512.png',
                    'apple-touch-icon-180x180.png'
                ],
                // The entry chunk exceeds workbox's 2 MB default precache limit
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                runtimeCaching: [
                    {
                        urlPattern: /^[a-z]+:\/\/[^/]+\/assets\/.+\.(js|css|wasm)$/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'assets-runtime',
                            expiration: { maxEntries: 200, purgeOnQuotaError: true }
                        }
                    }
                ]
            }
        })
    ],
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
        setupFiles: ['./tests/setup.ts']
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
                : process.env.TAURI_ENV_PLATFORM === 'android' ||
                    process.env.TAURI_ENV_PLATFORM === 'ios'
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
