# KeiAI

KeiAI is a cross-platform AI character chat application and customizable workflow runtime. It supports everything from simple character conversations to multimodal, multi-agent workflows without locking users into a model provider or a fixed interaction model.

> KeiAI is under active development.

## Features

- Native multi-character and multi-persona conversations
- Multi-user room conversations with E2EE sync
- Multimodal workflows using tool calling, multiple agents, image generation, TTS, and other media
- Events, pipelines, and templates for simple but flexible customization
- User-defined behavior through CharJS and plugins
- Block-based agent prompts and token-budget-aware prompt assembly
- Easy connections to multiple model providers and APIs
- Performance designed for large chats and continuous streaming
- Web, desktop, and mobile applications
- Local-first storage with E2EE sync and convergent encryption for assets
- Self-hostable server and Cloudflare Workers proxy

## Projects

| Path          | Description                             |
| ------------- | --------------------------------------- |
| `app/`        | Svelte frontend and application runtime |
| `pocketbase/` | Sync and account server                 |
| `proxy/`      | Stateless Cloudflare Workers proxy      |

## Development

Requires Node.js and pnpm.

```bash
# Web app
cd app
pnpm install
pnpm dev

# Server
cd pocketbase
node start.js

# Proxy
cd proxy
pnpm install
pnpm dev
```

## License

[AGPL-3.0](LICENSE)
