import { mount } from 'svelte';
import { isTauri } from '@tauri-apps/api/core';
import App from './App.svelte';
import './highlight-theme.css';
import 'katex/dist/katex.min.css';

const app = mount(App, {
    target: document.getElementById('app')!
});

// Tauri bundles its own assets; the service worker exists only for installed web builds
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isTauri()) {
    import('virtual:pwa-register')
        .then(({ registerSW }) => registerSW({ immediate: true }))
        .catch(() => undefined);
}

export default app;
