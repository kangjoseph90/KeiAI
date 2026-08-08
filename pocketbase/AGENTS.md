# PocketBase

PocketBase provides accounts, encrypted sync, multi-room access control, and encrypted asset storage. Domain logic and plaintext user content belong in `app/`.

## Files

| Path                                            | Responsibility                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `start.js`                                      | Load the root `.env`, upsert the superuser, and start PocketBase |
| `pb_migrations/1773000000_init_keiai_schema.js` | Canonical collections, access rules, and indexes                 |
| `pb_hooks/main.pb.js`                           | Routes and PocketBase hook registration                          |
| `pb_hooks/keiai.js`                             | Auth, room, asset, quota, and storage helpers                    |

## Data model

| Collection           | Purpose                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `users`              | Login identity, encrypted master-key bundles, identity keys, and encrypted profile |
| `records`            | User-scoped encrypted domain records routed by `kind`                              |
| `multi_room_index`   | Room ownership, discovery, visibility, and deletion metadata                       |
| `multi_room_members` | Membership state and encrypted room-key distribution                               |
| `multi_room_records` | Room-scoped encrypted domain records routed by `kind`                              |
| `asset_catalog`      | Content-addressed encrypted asset bytes stored locally or in R2                    |
| `asset_usage`        | Per-owner asset reference counts                                                   |
| `asset_accounts`     | Per-user asset usage and quota                                                     |

`records` and `multi_room_records` expose only routing, sync, deletion, and asset-reference metadata. Their domain payload remains encrypted in `encryptedData`.

## Invariants

- Never decrypt or interpret encrypted profiles, records, room keys, or assets on the server.
- Keep plaintext fields limited to data required for authentication, access control, synchronization, discovery, and storage accounting.
- Personal records are accessible only when `userId` matches the authenticated user. Room records require accepted membership in a live room.
- Soft-deleted records cannot be resurrected. The owner-only room deletion endpoint tombstones the room and removes its records.
- `updatedAt` is the client replica's logical LWW version. `serverUpdatedAt` is server-owned pull metadata and changes only when the canonical record actually changes; rejected stale or no-op writes preserve it.
- Assets are globally deduplicated by the SHA-256 hash of their ciphertext. Record `assetEntries` drive reference counts; room assets count against the room owner.
- Asset bytes use PocketBase file storage unless R2 is configured. Unreferenced assets are garbage-collected after the grace period.
- Keep AI providers, prompts, and other application behavior out of this project.

## Custom endpoints

| Area       | Endpoints                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Server     | `GET /api/spec`                                                                                                         |
| Account    | `POST /api/account/salt`, `POST /api/recovery/lookup`, `POST /api/recovery/reset-password`, `POST /api/recovery/delete` |
| Pairing    | `POST /api/pairing`, `GET /api/pairing/{lookupId}`                                                                      |
| Multi-room | `GET /api/multi-rooms/search`, `GET /api/users/{userId}/public-key`, join, leave, and owner deletion endpoints          |
| Assets     | Personal and room upload endpoints, authenticated download, and the superuser R2 migration endpoint                     |

PocketBase's collection and realtime APIs provide record synchronization. Custom endpoints handle operations that require server-controlled validation or lifecycle changes.

## Changes

- Treat the single init migration as the canonical schema while the project assumes clean database setup.
- Put route and hook registration in `main.pb.js`; put reusable implementation in `keiai.js`.
- Keep collection rules, custom endpoints, and the consuming app contract consistent.
- Preserve generic error responses for salt lookup, recovery, and pairing so account existence and secret validity are not exposed.
- Add plaintext metadata or a new endpoint only when the server must enforce the corresponding rule.

## Run

Copy the root `.env.example` to `.env`, configure the required PocketBase values, place the PocketBase binary in this directory, then run:

```bash
node start.js
```
