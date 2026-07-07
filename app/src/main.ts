import { mount } from 'svelte';
import App from './App.svelte';
import 'highlight.js/styles/github-dark.css';

const app = mount(App, {
    target: document.getElementById('app')!
});

export default app;
