# KeiAI Asset System

An asset belongs to the domain record that references it. The parent record is the source of truth; the registry and server tables are derived storage indexes.

## Identity and ownership

The encrypted parent payload stores the asset reference:

```ts
interface AssetFields {
  name: string;
  hash: string;
  encKey: string;
  mimeType: string;
  width?: number;
  height?: number;
}
```

`hash` identifies the ciphertext. `encKey` decrypts it and remains inside the encrypted parent payload. A reference ID identifies placement within one parent's `EntityListConfig`; it is not a global asset ID.

The parent record also exposes the minimal sync manifest:

```ts
type AssetEntries = Record<string, "local" | "remote">;
```

This lets sync and the server track binary availability without reading domain content or encryption keys.

## Storage

- The local asset registry is keyed by scope, parent, and hash. It indexes cached plaintext bytes, sync status, and eviction state.
- `asset_catalog` stores one ciphertext object per hash in PocketBase file storage or R2.
- `asset_usage` derives per-owner references from live parent `assetEntries`.
- `asset_accounts` stores each user's usage and quota.

The registry, usage rows, and account totals are not alternate sources of truth.

## Lifecycle

1. `AssetService.write()` normalizes supported media, preserves supported file bytes, and applies convergent encryption.
2. The content service writes the returned `AssetFields` into its parent and adds the hash to `assetEntries` as `local`.
3. Data sync sends the parent record. Asset sync uploads the ciphertext and marks the entry `remote`.
4. A missing local asset is fetched by hash, verified, decrypted with `encKey`, and cached under the requesting parent.
5. Removing the last reference from a parent removes its manifest entry and local registry row.
6. Server hooks derive usage from manifest changes; unreferenced ciphertext is garbage-collected after the grace period.

The same plaintext produces the same key, IV, ciphertext, and ciphertext hash. This enables server-wide deduplication without exposing plaintext. Multi-room asset usage is charged to the room owner.

## Media, files, and rendering

Images, audio, video, plain-text/code files, PDF, DOCX, PPTX, and XLSX share the same asset contract. `mimeType` determines rendering and provider mapping; dimensions preserve image and video layout when available. Non-media assets render as file cards and retain their original bytes for opening and download.

Templates and message inlays resolve parent-owned references into `AssetReadLocator` values. Runtime blob URLs are leased and released by the rendering layer; they are not persisted as asset identity.

Chat-owned attachments follow the same binary sync and server usage-accounting path as other parent-owned assets.

## LLM input

- The provider-neutral prompt contract uses a `file` part with the original name, MIME type, and base64 bytes.
- Plain-text and code attachments are decoded locally and bounded to 50,000 prompt characters, with an explicit truncation marker.
- OpenAI-compatible handlers send document parts natively when the selected model declares file support.
- Anthropic and Gemini send PDF natively and locally extract bounded text from DOCX, PPTX, and XLSX. A provider or model that cannot accept a file and has no local fallback raises a visible unsupported-input error.

## Size limits

Client limits apply to plaintext: 10 MiB for images and general files, 25 MiB for audio, and 100 MiB for video. The server accepts up to 100 MiB plus the 16-byte AES-GCM authentication tag because it stores ciphertext and cannot inspect the original media type.

## Invariants

- Do not create a separate synchronized asset record or global asset ID.
- Change asset references through the owning content service so the parent, manifest, and registry stay consistent.
- Never include `encKey` in sync-visible metadata or send plaintext bytes to the server.
- Verify downloaded and uploaded ciphertext against `hash`.
- Keep storage status out of domain references; it belongs in `assetEntries` and the local registry.
- Deleting a parent deletes its owner-scoped registry and cached bytes.
